import { describe, expect, it } from "vitest";
import {
  assertSafeXlsxArchive,
  assertWorkbookWithinLimits,
  decodeSafeCsv,
} from "@/lib/imports";

describe("import file safety", () => {
  it("accepts ordinary UTF-8 CSV and rejects binary or invalid UTF-8 content", () => {
    expect(decodeSafeCsv(new TextEncoder().encode("invoice,amount\nINV-1,10.00\n"))).toContain("INV-1");
    expect(() => decodeSafeCsv(Uint8Array.from([0x61, 0x00, 0x62]))).toThrow("unsafe_csv_binary");
    expect(() => decodeSafeCsv(Uint8Array.from([0xc3, 0x28]))).toThrow("unsafe_csv_encoding");
  });

  it("validates a normal XLSX central directory and rejects declared expansion", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Invoices").addRow(["Invoice", "Amount"]);
    const bytes = Uint8Array.from(await workbook.xlsx.writeBuffer() as unknown as Uint8Array);
    expect(() => assertSafeXlsxArchive(bytes)).not.toThrow();

    const altered = Uint8Array.from(bytes);
    const view = new DataView(altered.buffer);
    for (let offset = 0; offset + 46 <= altered.length; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 33 * 1024 * 1024, true);
        break;
      }
    }
    expect(() => assertSafeXlsxArchive(altered)).toThrow("unsafe_xlsx_expansion");
  }, 15_000);

  it("rejects workbooks whose dimensions exceed processing limits", () => {
    expect(() => assertWorkbookWithinLimits({
      worksheets: [{
        rowCount: 50_001,
        columnCount: 2,
        actualRowCount: 50_001,
        actualColumnCount: 2,
        eachRow() {},
      }],
    })).toThrow("unsafe_xlsx_dimensions");
  });
});
