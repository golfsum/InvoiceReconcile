import { describe, expect, it } from "vitest";
import {
  checkDuplicateImport,
  fingerprintImport,
  mappingFromSuggestions,
  normalizeInvoiceRows,
  normalizeInvoiceWorksheet,
  normalizePaymentRows,
  parseCsv,
  parseDate,
  parseMoney,
  suggestColumns,
} from "../../src/lib/imports";

describe("import normalization", () => {
  it("ignores trailing blank rows without reporting a malformed record", () => {
    const parsed = parseCsv("Invoice Number,Amount\nINV-1,1250\n   \n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toHaveLength(0);
  });

  it("reports malformed CSV instead of silently accepting it", () => {
    const parsed = parseCsv('Invoice Number,Amount\n"INV-1,1250');
    expect(parsed.issues.some((issue) => issue.code === "invalid_csv")).toBe(true);
  });

  it("detects practical invoice and payment header variants", () => {
    const invoiceSuggestions = suggestColumns(["Invoice #", "Client", "Issued Date", "Amount Due", "CCY"], "invoice");
    expect(mappingFromSuggestions(invoiceSuggestions)).toMatchObject({
      invoiceNumber: "Invoice #",
      customerName: "Client",
      invoiceDate: "Issued Date",
      outstandingBalance: "Amount Due",
      currency: "CCY",
    });
    expect(mappingFromSuggestions(suggestColumns(["Posted Date", "Credit Amount", "Originator", "Txn ID"], "payment"))).toMatchObject({
      paymentDate: "Posted Date",
      amount: "Credit Amount",
      payerName: "Originator",
      transactionId: "Txn ID",
    });
  });

  it("parses supported date formats with an explicit ambiguous-date order", () => {
    expect(parseDate("2026-07-09")).toBe("2026-07-09");
    expect(parseDate("07/09/2026", "MDY")).toBe("2026-07-09");
    expect(parseDate("07/09/2026", "DMY")).toBe("2026-09-07");
    expect(parseDate("9 Jul 2026")).toBe("2026-07-09");
    expect(parseDate(46_582)).toBe("2027-07-14");
  });

  it("parses currency symbols, grouping, decimal commas and negatives", () => {
    expect(parseMoney("$1,250.50")).toEqual({ minor: 125_050, currencyHint: "USD" });
    expect(parseMoney("EUR 1.250,50")).toEqual({ minor: 125_050, currencyHint: "EUR" });
    expect(parseMoney("(£25.00)")).toEqual({ minor: -2_500, currencyHint: "GBP" });
  });

  it("normalizes CSV-style invoice rows while preserving extra source values", () => {
    const rows = [{
      "Invoice #": "INV-9",
      Client: "Acme LLC",
      Date: "6/1/2026",
      Total: "$1,250.00",
      "Amount Due": "$1,000.00",
      Extra: "preserved",
    }];
    const mapping = mappingFromSuggestions(suggestColumns(Object.keys(rows[0]), "invoice"));
    const result = normalizeInvoiceRows(rows, mapping, { sourceImportId: "source-a" });
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted[0].value).toMatchObject({
      invoiceNumber: "INV-9",
      customerName: "Acme LLC",
      invoiceDate: "2026-06-01",
      originalAmountMinor: 125_000,
      outstandingAmountMinor: 100_000,
      currency: "USD",
      sourceRow: 2,
    });
    expect(result.accepted[0].raw.Extra).toBe("preserved");
  });

  it("normalizes Excel dates and computed formula results", () => {
    const result = normalizeInvoiceWorksheet([
      ["Invoice Number", "Customer Name", "Invoice Date", "Original Amount", "Outstanding Balance", "Currency"],
      ["INV-XLSX-1", { text: "Northstar Services" }, new Date("2026-06-15T00:00:00Z"), { formula: "SUM(A1:A2)", result: 1250 }, { sharedFormula: "A1", result: 1000 }, "USD"],
    ], { sourceImportId: "workbook-a" });
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted[0].value).toMatchObject({
      invoiceNumber: "INV-XLSX-1",
      customerName: "Northstar Services",
      invoiceDate: "2026-06-15",
      originalAmountMinor: 125_000,
      outstandingAmountMinor: 100_000,
    });
  });

  it("reports blank, invalid and duplicate rows without double importing", () => {
    const rows = [
      { Date: "2026-07-01", Amount: "$500.00", Payer: "Acme", "Transaction ID": "TX-1" },
      { Date: "2026-07-01", Amount: "$500.00", Payer: "Acme", "Transaction ID": "TX-1" },
      { Date: "", Amount: "", Payer: "", "Transaction ID": "" },
      { Date: "not-a-date", Amount: "abc", Payer: "Broken", "Transaction ID": "TX-2" },
    ];
    const mapping = mappingFromSuggestions(suggestColumns(Object.keys(rows[0]), "payment"));
    const result = normalizePaymentRows(rows, mapping);
    expect(result.accepted).toHaveLength(1);
    expect(result.skippedBlankRows).toEqual([4]);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["duplicate_row", "invalid_date", "invalid_amount"]));
  });

  it("rejects invoice values that cannot satisfy durable ledger constraints", () => {
    const rows = [
      { Number: "INV-ZERO", Customer: "Acme", Date: "2026-07-01", Due: "2026-06-30", Original: "0", Outstanding: "10" },
      { Number: "INV-OVER", Customer: "Acme", Date: "2026-07-01", Due: "2026-07-31", Original: "100", Outstanding: "125" },
    ];
    const mapping = {
      invoiceNumber: "Number",
      customerName: "Customer",
      invoiceDate: "Date",
      dueDate: "Due",
      originalAmount: "Original",
      outstandingBalance: "Outstanding",
    } as const;
    const result = normalizeInvoiceRows(rows, mapping);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "The due date cannot be earlier than the invoice date.",
      "The original amount must be greater than zero.",
      "The outstanding balance must be between zero and the original amount.",
    ]));
  });

  it("fingerprints source files for import idempotency", () => {
    const fingerprint = fingerprintImport("a,b\n1,2\n");
    expect(fingerprintImport("a,b\r\n1,2\r\n")).toBe(fingerprint);
    expect(checkDuplicateImport(fingerprint, [fingerprint])).toMatchObject({ code: "duplicate_file" });
    expect(checkDuplicateImport(fingerprint, [])).toBeUndefined();
  });
});
