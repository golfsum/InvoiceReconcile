import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_PARSED_CELL_TEXT_LENGTH,
  MAX_PARSED_HEADERS,
  MAX_PARSED_HEADER_LENGTH,
  MAX_PARSED_TOTAL_CHARACTERS,
  assertActualXlsxExpansionWithinLimits,
  assertParsedTableWithinLimits,
  readImportBytes,
} from "@/lib/imports/server-file";

describe("durable import parser limits", () => {
  it("bounds headers and row width before normalization", () => {
    expect(() => assertParsedTableWithinLimits(
      Array.from({ length: MAX_PARSED_HEADERS + 1 }, (_, index) => `column_${index}`),
      [],
    )).toThrow("unsafe_table_headers");
    expect(() => assertParsedTableWithinLimits(
      ["h".repeat(MAX_PARSED_HEADER_LENGTH + 1)],
      [],
    )).toThrow("unsafe_table_headers");
    expect(() => assertParsedTableWithinLimits(
      ["column"],
      [Object.fromEntries(Array.from({ length: MAX_PARSED_HEADERS + 1 }, (_, index) => [`column_${index}`, "x"]))],
    )).toThrow("unsafe_table_row_width");
  });

  it("bounds individual cells and aggregate parsed characters", () => {
    expect(() => assertParsedTableWithinLimits(
      ["memo"],
      [{ memo: "x".repeat(MAX_PARSED_CELL_TEXT_LENGTH + 1) }],
    )).toThrow("unsafe_table_cell");

    const repeatedCell = "x".repeat(MAX_PARSED_CELL_TEXT_LENGTH);
    const rowCount = Math.floor(MAX_PARSED_TOTAL_CHARACTERS / repeatedCell.length) + 1;
    expect(() => assertParsedTableWithinLimits(
      ["memo"],
      Array.from({ length: rowCount }, () => ({ memo: repeatedCell })),
    )).toThrow("unsafe_table_characters");
  });

  it("rejects an adversarial CSV cell through the actual read path", async () => {
    const bytes = new TextEncoder().encode(`memo\n${"x".repeat(MAX_PARSED_CELL_TEXT_LENGTH + 1)}\n`);
    await expect(readImportBytes({ bytes, sourceType: "csv" })).rejects.toThrow("unsafe_table_cell");
  });

  it("rejects an adversarial XLSX cell through the actual read path", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Payments");
    worksheet.addRow(["memo"]);
    worksheet.addRow(["x".repeat(MAX_PARSED_CELL_TEXT_LENGTH + 1)]);
    const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
    await expect(readImportBytes({ bytes, sourceType: "xlsx" })).rejects.toThrow("unsafe_table_cell");
  }, 20_000);

  it("rejects a sparse XLSX row before include-empty iteration can expand it", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sparse");
    worksheet.getCell("A1").value = "memo";
    worksheet.getCell("A50001").value = "far away";
    const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
    await expect(readImportBytes({ bytes, sourceType: "xlsx" })).rejects.toThrow("unsafe_xlsx_dimensions");
  }, 20_000);

  it("rejects a sparse far-column XLSX before row materialization", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sparse columns");
    worksheet.getCell("A1").value = "memo";
    worksheet.getCell("XFD1").value = "far away";
    const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
    await expect(readImportBytes({ bytes, sourceType: "xlsx" })).rejects.toThrow("unsafe_xlsx_dimensions");
  }, 20_000);

  it("counts actual inflated bytes even when central-directory size metadata is false", async () => {
    const JSZip = (await import("jszip")).default;
    const bytes = await new JSZip().file("xl/worksheets/sheet1.xml", "x".repeat(8_192))
      .generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const altered = Uint8Array.from(bytes);
    const view = new DataView(altered.buffer, altered.byteOffset, altered.byteLength);
    for (let offset = 0; offset + 46 <= altered.byteLength; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 1, true);
        break;
      }
    }
    await expect(assertActualXlsxExpansionWithinLimits(altered, {
      maxEntryBytes: 1_024,
      maxTotalBytes: 1_024,
    })).rejects.toThrow("unsafe_xlsx_actual_expansion");
  });
});
