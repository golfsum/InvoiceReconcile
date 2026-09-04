import "server-only";

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { z } from "zod";
import { assertSafeXlsxArchive, assertWorkbookWithinLimits, decodeSafeCsv } from "./file-safety";
import { fingerprintImport, parseCsv } from "./csv";
import { mappingFromSuggestions, suggestColumns } from "./columns";
import type { ColumnMapping, ImportKind, ImportIssue, RawImportRow } from "./types";
import { worksheetRowsToObjects } from "./normalize";

export const MAX_DURABLE_IMPORT_BYTES = 50 * 1024 * 1024;
export const MAX_DURABLE_IMPORT_ROWS = 50_000;
export const MAX_PARSED_HEADERS = 256;
export const MAX_PARSED_HEADER_LENGTH = 200;
export const MAX_PARSED_CELL_TEXT_LENGTH = 10_000;
export const MAX_PARSED_TOTAL_CHARACTERS = 20_000_000;

const mappingSchema = z.record(z.string(), z.string());

export type ImportSourceType = "csv" | "xlsx";

export type ParsedImportSource = {
  headers: string[];
  rows: RawImportRow[];
  parseIssues: ImportIssue[];
  fingerprint: string;
  sha256: string;
  byteLength: number;
  sheets: string[];
  selectedSheet?: string;
};

export async function assertActualXlsxExpansionWithinLimits(
  bytes: Uint8Array,
  limits: {
    maxEntryBytes?: number;
    maxTotalBytes?: number;
    maxWorksheets?: number;
    maxRowsPerWorksheet?: number;
    maxWorkbookCells?: number;
  } = {},
) {
  const maxEntryBytes = limits.maxEntryBytes ?? 32 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 64 * 1024 * 1024;
  const maxWorksheets = limits.maxWorksheets ?? 20;
  const maxRowsPerWorksheet = limits.maxRowsPerWorksheet ?? 50_000;
  const maxWorkbookCells = limits.maxWorkbookCells ?? 2_000_000;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  let totalBytes = 0;
  let worksheetCount = 0;
  let workbookCells = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const isWorksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name);
    if (isWorksheet) {
      worksheetCount += 1;
      if (worksheetCount > maxWorksheets) throw new Error("unsafe_xlsx_actual_dimensions");
    }
    let entryBytes = 0;
    let worksheetRows = 0;
    let scanTail = "";
    const stream = entry.nodeStream("nodebuffer") as Readable;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(error);
        };
        stream.on("data", (chunk: Buffer | Uint8Array | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const chunkBytes = buffer.byteLength;
          entryBytes += chunkBytes;
          totalBytes += chunkBytes;
          if (entryBytes > maxEntryBytes || totalBytes > maxTotalBytes) {
            fail(new Error("unsafe_xlsx_actual_expansion"));
            return;
          }
          if (!isWorksheet) return;
          const text = scanTail + buffer.toString("utf8");
          const scanLength = Math.max(0, text.length - 16);
          const safeText = text.slice(0, scanLength);
          scanTail = text.slice(scanLength);
          workbookCells += safeText.match(/<c(?=[\s/>])/g)?.length ?? 0;
          worksheetRows += safeText.match(/<row(?=[\s/>])/g)?.length ?? 0;
          if (workbookCells > maxWorkbookCells || worksheetRows > maxRowsPerWorksheet) {
            fail(new Error("unsafe_xlsx_actual_dimensions"));
          }
        });
        stream.once("error", (error) => fail(error instanceof Error ? error : new Error("unsafe_xlsx_archive")));
        stream.once("end", () => {
          if (settled) return;
          settled = true;
          resolve();
        });
      });
      if (isWorksheet) {
        workbookCells += scanTail.match(/<c(?=[\s/>])/g)?.length ?? 0;
        worksheetRows += scanTail.match(/<row(?=[\s/>])/g)?.length ?? 0;
        if (workbookCells > maxWorkbookCells || worksheetRows > maxRowsPerWorksheet) {
          throw new Error("unsafe_xlsx_actual_dimensions");
        }
      }
    } catch (error) {
      if (error instanceof Error
          && (error.message === "unsafe_xlsx_actual_expansion" || error.message === "unsafe_xlsx_actual_dimensions")) throw error;
      throw new Error("unsafe_xlsx_archive");
    }
  }
}

function assertByteLength(bytes: Uint8Array, maxBytes: number) {
  if (bytes.byteLength === 0) throw new Error("empty");
  if (bytes.byteLength > maxBytes) throw new Error("large");
}

function assertRowLimit(rows: RawImportRow[]) {
  if (rows.length > MAX_DURABLE_IMPORT_ROWS) throw new Error("too_many_rows");
}

function parsedCellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    throw new Error("unsafe_table_cell");
  }
}

export function assertParsedTableWithinLimits(headers: string[], rows: RawImportRow[]) {
  if (headers.length > MAX_PARSED_HEADERS
      || headers.some((header) => header.length === 0 || header.length > MAX_PARSED_HEADER_LENGTH)) {
    throw new Error("unsafe_table_headers");
  }
  let totalCharacters = headers.reduce((total, header) => total + header.length, 0);
  for (const row of rows) {
    const values = Object.values(row);
    if (values.length > MAX_PARSED_HEADERS) throw new Error("unsafe_table_row_width");
    for (const value of values) {
      const text = parsedCellText(value);
      if (text.length > MAX_PARSED_CELL_TEXT_LENGTH) throw new Error("unsafe_table_cell");
      totalCharacters += text.length;
      if (totalCharacters > MAX_PARSED_TOTAL_CHARACTERS) throw new Error("unsafe_table_characters");
    }
  }
}

export function importSourceTypeFromName(name: string): ImportSourceType | null {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "csv" || extension === "xlsx" ? extension : null;
}

export async function readImportBytes(input: {
  bytes: Uint8Array;
  sourceType: ImportSourceType;
  requestedSheet?: string;
  maxBytes?: number;
}): Promise<ParsedImportSource> {
  const { bytes, sourceType, requestedSheet } = input;
  assertByteLength(bytes, input.maxBytes ?? MAX_DURABLE_IMPORT_BYTES);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (sourceType === "csv") {
    const parsed = parseCsv(decodeSafeCsv(bytes));
    assertRowLimit(parsed.rows);
    assertParsedTableWithinLimits(parsed.headers, parsed.rows);
    return {
      headers: parsed.headers,
      rows: parsed.rows,
      parseIssues: parsed.issues,
      fingerprint: fingerprintImport(bytes),
      sha256,
      byteLength: bytes.byteLength,
      sheets: [],
    };
  }

  assertSafeXlsxArchive(bytes);
  await assertActualXlsxExpansionWithinLimits(bytes);
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assertWorkbookWithinLimits(workbook);
  const sheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const worksheet = (requestedSheet ? workbook.getWorksheet(requestedSheet) : undefined)
    || workbook.worksheets.find((item) => item.actualRowCount > 0);
  if (!worksheet) throw new Error("sheet");
  const worksheetRows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    worksheetRows.push(Array.isArray(row.values) ? row.values.slice(1) : []);
  });
  const converted = worksheetRowsToObjects(worksheetRows);
  assertRowLimit(converted.rows);
  assertParsedTableWithinLimits(converted.headers, converted.rows);
  return {
    headers: converted.headers,
    rows: converted.rows,
    parseIssues: [],
    fingerprint: fingerprintImport(bytes),
    sha256,
    byteLength: bytes.byteLength,
    sheets,
    selectedSheet: worksheet.name,
  };
}

export async function readUploadedImportFile(file: File, requestedSheet?: string, maxBytes?: number) {
  const sourceType = importSourceTypeFromName(file.name);
  if (!sourceType) throw new Error("type");
  return readImportBytes({
    bytes: new Uint8Array(await file.arrayBuffer()),
    sourceType,
    requestedSheet,
    maxBytes,
  });
}

export function requestedColumnMapping(
  raw: FormDataEntryValue | string | null,
  headers: string[],
  kind: ImportKind,
): ColumnMapping {
  const automatic = mappingFromSuggestions(suggestColumns(headers, kind));
  if (typeof raw !== "string") return automatic;
  try {
    const parsed = mappingSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return automatic;
    return Object.fromEntries(
      Object.entries(parsed.data).filter(([, header]) => headers.includes(header)),
    ) as ColumnMapping;
  } catch {
    return automatic;
  }
}
