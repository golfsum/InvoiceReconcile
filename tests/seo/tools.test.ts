import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  calculateManualReconciliationTime,
  cleanInvoiceReference,
  findLumpSumCombinations,
  findUniqueExactMatches,
  parseAmountRows,
  parseCurrencyToCents,
} from "@/content/seo/tools";

describe("SEO acquisition tools", () => {
  it("parses currency without floating point drift", () => {
    expect(parseCurrencyToCents("$4,725.09")).toBe(472509);
    expect(parseCurrencyToCents("12.345")).toBeNull();
    expect(parseCurrencyToCents("-5")).toBeNull();
  });

  it("finds bounded lump-sum combinations", () => {
    const { rows } = parseAmountRows("INV-1, 1500\nINV-2, 1225\nINV-3, 2000\nINV-4, 750", "Invoice");
    const results = findLumpSumCombinations(472500, rows);
    expect(results).toHaveLength(1);
    expect(results[0].map((row) => row.label).sort()).toEqual(["INV-1", "INV-2", "INV-3"]);
  });

  it("refuses an unbounded candidate list", () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: `${index}`, label: `${index}`, cents: 100 }));
    expect(findLumpSumCombinations(500, rows)).toEqual([]);
  });

  it("only marks amount pairs unique on both sides", () => {
    const invoices = parseAmountRows("INV-1, 1250\nINV-2, 800\nINV-3, 800").rows;
    const payments = parseAmountRows("PAY-1, 1250\nPAY-2, 800\nPAY-3, 1900").rows;
    const result = findUniqueExactMatches(invoices, payments);
    expect(result.matches.map((match) => match.invoice.label)).toEqual(["INV-1"]);
    expect(result.ambiguousPayments.map((payment) => payment.label)).toEqual(["PAY-2"]);
    expect(result.unmatchedPayments.map((payment) => payment.label)).toEqual(["PAY-3"]);
  });

  it("allocates payment in the stated invoice order", () => {
    const invoices = parseAmountRows("INV-1, 3000\nINV-2, 4000\nINV-3, 1200").rows;
    const result = allocatePayment(500000, invoices);
    expect(result.lines.map((line) => line.appliedCents)).toEqual([300000, 200000, 0]);
    expect(result.lines.map((line) => line.remainingCents)).toEqual([0, 200000, 120000]);
    expect(result.unappliedCents).toBe(0);
  });

  it("keeps overpayment unapplied", () => {
    const invoices = parseAmountRows("INV-1, 1000").rows;
    expect(allocatePayment(125000, invoices).unappliedCents).toBe(25000);
  });

  it("calculates manual process time without claiming savings", () => {
    expect(calculateManualReconciliationTime(500, 3, 35)).toEqual({ monthlyHours: 25, monthlyLaborCost: 875, annualLaborCost: 10500 });
  });

  it("normalizes common invoice reference formats", () => {
    expect(cleanInvoiceReference("invoice # 10487")).toBe("INV-10487");
    expect(cleanInvoiceReference(" Inv.No: 105-02 ")).toBe("INV-105-02");
    expect(cleanInvoiceReference("PO / west 44")).toBe("PO-WEST-44");
  });
});
