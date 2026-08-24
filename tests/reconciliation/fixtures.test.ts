import { describe, expect, it } from "vitest";
import { northstarDemoFixture, reconcile } from "../../src/lib/reconciliation";

describe("Northstar Services demo fixture", () => {
  it("contains the promised fictional 30 invoices and 22 payments", () => {
    expect(northstarDemoFixture.invoices).toHaveLength(30);
    expect(northstarDemoFixture.payments).toHaveLength(22);
    expect(northstarDemoFixture.notice.toLowerCase()).toContain("fictional");
  });

  it("exercises the difficult reconciliation scenarios", () => {
    const result = reconcile([...northstarDemoFixture.invoices], [...northstarDemoFixture.payments]);
    const methods = result.matches.map((match) => match.method);
    expect(methods).toEqual(expect.arrayContaining([
      "reference_match",
      "combined_invoices",
      "grouped_payments",
      "partial_payment",
      "possible_fee_or_deduction",
      "overpayment",
      "duplicate_payment",
      "unmatched",
    ]));
  });
});
