import { describe, expect, it } from "vitest";
import { neutralizeSpreadsheetValue, quoteCsvCell, safeSpreadsheetRows } from "@/lib/exports/spreadsheet";

describe("spreadsheet export hardening", () => {
  it.each(["=2+2", "+SUM(A1:A2)", "-1+1", "@cmd", "  =HYPERLINK(\"https://example.test\")", "\t+1"])(
    "neutralizes formula-shaped text: %s",
    (value) => expect(neutralizeSpreadsheetValue(value)).toBe(`'${value}`),
  );

  it("preserves ordinary text and numeric cell types", () => {
    expect(neutralizeSpreadsheetValue("INV-10487")).toBe("INV-10487");
    expect(neutralizeSpreadsheetValue(4725)).toBe(4725);
    expect(safeSpreadsheetRows([["=1+1", 4725]])).toEqual([["'=1+1", 4725]]);
  });

  it("quotes and escapes CSV after neutralizing the value", () => {
    expect(quoteCsvCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
  });
});
