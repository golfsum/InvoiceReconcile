const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;

export const IMPORT_FILE_LIMITS = {
  maxArchiveEntries: 512,
  maxArchiveUncompressedBytes: 64 * 1024 * 1024,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxWorksheets: 20,
  maxRowsPerWorksheet: 50_000,
  maxColumnsPerWorksheet: 256,
  maxWorkbookCells: 2_000_000,
  maxCellTextLength: 50_000,
  maxCsvRows: 100_000,
  maxCsvLineBytes: 1024 * 1024,
} as const;

function fail(code: string): never {
  throw new Error(code);
}

export function decodeSafeCsv(bytes: Uint8Array) {
  let controlBytes = 0;
  let rows = 1;
  let lineBytes = 0;
  for (const byte of bytes) {
    if (byte === 0) fail("unsafe_csv_binary");
    if (byte === 10) {
      rows += 1;
      lineBytes = 0;
      if (rows > IMPORT_FILE_LIMITS.maxCsvRows + 1) fail("unsafe_csv_rows");
      continue;
    }
    lineBytes += 1;
    if (lineBytes > IMPORT_FILE_LIMITS.maxCsvLineBytes) fail("unsafe_csv_line");
    if (byte < 32 && byte !== 9 && byte !== 13) controlBytes += 1;
  }
  if (controlBytes > Math.max(8, Math.floor(bytes.length / 1_000))) fail("unsafe_csv_binary");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("unsafe_csv_encoding");
  }
}

function findZipEnd(view: DataView) {
  const earliest = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END) return offset;
  }
  return -1;
}

export function assertSafeXlsxArchive(bytes: Uint8Array) {
  if (bytes.length < 22) fail("unsafe_xlsx_archive");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ZIP_LOCAL_FILE) fail("unsafe_xlsx_archive");
  const endOffset = findZipEnd(view);
  if (endOffset < 0) fail("unsafe_xlsx_archive");

  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount === 0 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail("unsafe_xlsx_archive");
  if (entryCount > IMPORT_FILE_LIMITS.maxArchiveEntries) fail("unsafe_xlsx_entries");
  if (centralOffset + centralSize > bytes.length) fail("unsafe_xlsx_archive");

  let offset = centralOffset;
  let totalUncompressed = 0;
  let hasContentTypes = false;
  let hasWorkbook = false;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL_FILE) fail("unsafe_xlsx_archive");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > bytes.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) fail("unsafe_xlsx_archive");
    if ((flags & 1) !== 0) fail("unsafe_xlsx_encrypted");
    if (method !== 0 && method !== 8) fail("unsafe_xlsx_compression");
    if (uncompressedSize > IMPORT_FILE_LIMITS.maxEntryUncompressedBytes) fail("unsafe_xlsx_expansion");
    if (uncompressedSize > 1024 * 1024 && uncompressedSize / Math.max(1, compressedSize) > IMPORT_FILE_LIMITS.maxCompressionRatio) fail("unsafe_xlsx_expansion");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > IMPORT_FILE_LIMITS.maxArchiveUncompressedBytes) fail("unsafe_xlsx_expansion");

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replaceAll("\\", "/");
    if (name === "[Content_Types].xml") hasContentTypes = true;
    if (name === "xl/workbook.xml") hasWorkbook = true;
    offset = nextOffset;
  }
  if (!hasContentTypes || !hasWorkbook) fail("unsafe_xlsx_archive");
}

type CellLike = { value: unknown };
type RowLike = { eachCell(options: { includeEmpty: boolean }, callback: (cell: CellLike) => void): void };
type WorksheetLike = {
  rowCount: number;
  columnCount: number;
  actualRowCount: number;
  actualColumnCount: number;
  eachRow(options: { includeEmpty: boolean }, callback: (row: RowLike) => void): void;
};

export function assertWorkbookWithinLimits(value: unknown) {
  const workbook = value as { worksheets?: WorksheetLike[] };
  const worksheets = workbook.worksheets;
  if (!Array.isArray(worksheets) || worksheets.length === 0 || worksheets.length > IMPORT_FILE_LIMITS.maxWorksheets) fail("unsafe_xlsx_dimensions");
  let estimatedCells = 0;
  for (const worksheet of worksheets) {
    const dimensions = [worksheet.rowCount, worksheet.columnCount, worksheet.actualRowCount, worksheet.actualColumnCount];
    if (dimensions.some((dimension) => !Number.isSafeInteger(dimension) || dimension < 0)
        || worksheet.rowCount > IMPORT_FILE_LIMITS.maxRowsPerWorksheet
        || worksheet.actualRowCount > IMPORT_FILE_LIMITS.maxRowsPerWorksheet
        || worksheet.columnCount > IMPORT_FILE_LIMITS.maxColumnsPerWorksheet
        || worksheet.actualColumnCount > IMPORT_FILE_LIMITS.maxColumnsPerWorksheet) fail("unsafe_xlsx_dimensions");
    estimatedCells += Math.max(worksheet.rowCount, worksheet.actualRowCount)
      * Math.max(1, worksheet.columnCount, worksheet.actualColumnCount);
    if (estimatedCells > IMPORT_FILE_LIMITS.maxWorkbookCells) fail("unsafe_xlsx_dimensions");
    worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const text = typeof cell.value === "string" ? cell.value : cell.value && typeof cell.value === "object" ? JSON.stringify(cell.value) : "";
      if (text && text.length > IMPORT_FILE_LIMITS.maxCellTextLength) fail("unsafe_xlsx_cell");
    }));
  }
}

export function uploadSafetyMessage(code: string, kind: "csv" | "xlsx") {
  if (code === "unsafe_csv_encoding") return "Save the CSV as UTF-8 and try again.";
  if (code.startsWith("unsafe_csv")) return "The CSV contains binary data or exceeds the safe row and line limits.";
  if (code === "unsafe_xlsx_encrypted") return "Encrypted workbooks are not supported. Save an unencrypted copy and try again.";
  if (code.startsWith("unsafe_xlsx")) return "The workbook exceeds safe archive, worksheet, row, column, or cell limits.";
  return kind === "xlsx" ? "We could not read this workbook. Check that it is a valid, unencrypted XLSX file." : "We could not parse this CSV file. Check the delimiter and quoted values.";
}
