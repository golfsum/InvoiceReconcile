import { describe, expect, it } from "vitest";
import { reconcile } from "@/lib/reconciliation/engine";
import { canonicalReferenceTemplate } from "@/lib/reconciliation/custom-rules";
import { northstarInvoices, northstarPayments } from "@/lib/reconciliation/fixtures/northstar";
import type { CustomMatchingRule, Invoice, Payment } from "@/lib/reconciliation/types";

const baseInvoice: Invoice = {
  id: "invoice-a",
  invoiceNumber: "INV-A",
  customerName: "Acme Consulting LLC",
  customerId: "ACME-001",
  invoiceDate: "2026-07-01",
  originalAmountMinor: 10_000,
  outstandingAmountMinor: 10_000,
  currency: "USD",
  status: "open",
};

const basePayment: Payment = {
  id: "payment-a",
  paymentDate: "2026-07-02",
  amountMinor: 10_000,
  currency: "USD",
  payerName: "Unknown Treasury",
  description: "Monthly remittance",
};

function descriptionRule(overrides: Partial<Extract<CustomMatchingRule, { kind: "description_customer" }>> = {}): Extract<CustomMatchingRule, { kind: "description_customer" }> {
  return {
    id: "rule-description",
    kind: "description_customer",
    sourcePattern: "Parent remittance",
    normalizedPattern: "PARENT REMITTANCE",
    customerId: "customer-row-a",
    customerName: "Acme Consulting LLC",
    customerExternalId: "ACME-001",
    ...overrides,
  };
}

describe("bounded custom matching rules", () => {
  it("accepts one bounded reference token and rejects regex or multiple wildcards", () => {
    expect(canonicalReferenceTemplate("NS-2026-{digits}")).toBe("NS-2026-{DIGITS}");
    expect(canonicalReferenceTemplate("NS-{alnum}")).toBe("NS-{ALNUM}");
    expect(canonicalReferenceTemplate("NS-2026-[0-9]+")).toBeNull();
    expect(canonicalReferenceTemplate("{digits}{alnum}")).toBeNull();
    expect(canonicalReferenceTemplate("NS-{digits}-{digits}")).toBeNull();
    expect(canonicalReferenceTemplate("{digits}")).toBeNull();
    expect(canonicalReferenceTemplate("Café-{digits}")).toBeNull();
  });

  it("uses a description mapping as transparent identity evidence", () => {
    const other = { ...baseInvoice, id: "invoice-b", invoiceNumber: "INV-B", customerName: "Beta Supply LLC", customerId: "BETA-001" };
    const result = reconcile([baseInvoice, other], [{ ...basePayment, description: "ACH parent remittance July" }], {}, {
      customRules: [descriptionRule()],
    });
    expect(result.matches[0]).toMatchObject({
      invoiceIds: [baseInvoice.id],
      confidence: "high_confidence",
      requiresConfirmation: true,
      evidence: expect.arrayContaining([expect.objectContaining({ code: "description_mapping_exact" })]),
    });
  });

  it("extracts a reference from a safe template only inside the date window", () => {
    const referenceRule: CustomMatchingRule = {
      id: "rule-reference",
      kind: "reference_template",
      sourcePattern: "NS-2026-{digits}",
      normalizedPattern: "NS-2026-{DIGITS}",
    };
    const invoice = { ...baseInvoice, invoiceNumber: "NS-2026-0042" };
    const payment = { ...basePayment, description: "Settlement NS-2026-0042 received" };
    const inWindow = reconcile([invoice], [payment], {}, { customRules: [referenceRule] });
    expect(inWindow.matches[0]).toMatchObject({
      method: "reference_match",
      invoiceIds: [invoice.id],
      evidence: expect.arrayContaining([expect.objectContaining({ code: "reference_template_exact" })]),
    });
    expect(inWindow.matches[0].confidence === "exact"
      ? inWindow.matches[0].evidence.some((item) => item.code === "reference_exact")
      : inWindow.matches[0].requiresConfirmation).toBe(true);

    const outsideInvoice = { ...invoice, invoiceDate: "2025-01-01" };
    const outsideWindow = reconcile([outsideInvoice], [payment], {}, { customRules: [referenceRule] });
    const baselineOutsideWindow = reconcile([outsideInvoice], [payment]);
    expect(outsideWindow.matches[0]).toMatchObject({ confidence: "high_confidence", requiresConfirmation: true });
    expect({ ...outsideWindow.matches[0], evidence: outsideWindow.matches[0].evidence.filter((item) => item.code !== "reference_template_exact"), reasons: outsideWindow.matches[0].reasons.filter((reason) => !reason.includes("Workspace template")) })
      .toEqual(baselineOutsideWindow.matches[0]);
  });

  it("keeps a combined allocation confirmable unless every invoice has a native reference", () => {
    const first = { ...baseInvoice, id: "invoice-first", invoiceNumber: "NS-2026-0042", outstandingAmountMinor: 6_000 };
    const second = { ...baseInvoice, id: "invoice-second", invoiceNumber: "NS-2026-0043", outstandingAmountMinor: 4_000 };
    const referenceRule: CustomMatchingRule = {
      id: "rule-reference",
      kind: "reference_template",
      sourcePattern: "NS-2026-{digits}",
      normalizedPattern: "NS-2026-{DIGITS}",
    };
    const result = reconcile([first, second], [{
      ...basePayment,
      payerName: baseInvoice.customerName,
      description: "Settlement NS-2026-0042",
    }], {}, { customRules: [referenceRule] });

    expect(result.matches[0]).toMatchObject({
      method: "combined_invoices",
      invoiceIds: [first.id, second.id],
      confidence: "high_confidence",
      requiresConfirmation: true,
    });
  });

  it("keeps conflicting description targets ambiguous", () => {
    const beta = { ...baseInvoice, id: "invoice-b", invoiceNumber: "INV-B", customerName: "Beta Supply LLC", customerId: "BETA-001" };
    const rules: CustomMatchingRule[] = [
      descriptionRule({ sourcePattern: "Alpha", normalizedPattern: "ALPHA" }),
      descriptionRule({ id: "rule-beta", sourcePattern: "Beta", normalizedPattern: "BETA", customerId: "customer-row-b", customerName: "Beta Supply LLC", customerExternalId: "BETA-001" }),
    ];
    const result = reconcile([baseInvoice, beta], [{ ...basePayment, description: "Alpha Beta" }], {}, { customRules: rules });
    expect(result.matches[0]).toMatchObject({ method: "ambiguous", confidence: "review", requiresConfirmation: true });
  });

  it("adds fee evidence without widening limits or removing confirmation", () => {
    const feeRule: CustomMatchingRule = {
      id: "rule-fee",
      kind: "accepted_fee_behavior",
      sourcePattern: "Card settlement",
      normalizedPattern: "CARD SETTLEMENT",
      maximumFeeMinor: 500,
      maximumFeeBasisPoints: 300,
    };
    const payment = { ...basePayment, payerName: baseInvoice.customerName, description: "Card settlement", amountMinor: 9_700 };
    const result = reconcile([baseInvoice], [payment], {}, { customRules: [feeRule] });
    expect(result.matches[0]).toMatchObject({
      method: "possible_fee_or_deduction",
      confidence: "review",
      requiresConfirmation: true,
      appliedAmountMinor: 9_700,
      remainingInvoiceBalanceMinor: 300,
      evidence: expect.arrayContaining([expect.objectContaining({ code: "fee_behavior_review" })]),
    });

    const stricter = reconcile([baseInvoice], [payment], {}, { customRules: [{ ...feeRule, maximumFeeBasisPoints: 200 }] });
    expect(stricter.matches[0].method).toBe("possible_fee_or_deduction");
    expect(stricter.matches[0].evidence.some((item) => item.code === "fee_behavior_review")).toBe(false);
  });

  it("does not let a customer rule bypass currency blocking", () => {
    const result = reconcile([baseInvoice], [{ ...basePayment, currency: "EUR", description: "Parent remittance" }], {}, {
      customRules: [descriptionRule()],
    });
    expect(result.matches[0]).toMatchObject({ method: "currency_mismatch", confidence: "unmatched", appliedAmountMinor: 0 });
  });

  it("preserves the Northstar result byte for byte when no custom rules exist", () => {
    expect(JSON.stringify(reconcile(northstarInvoices, northstarPayments, {}, { customRules: [] })))
      .toBe(JSON.stringify(reconcile(northstarInvoices, northstarPayments)));
  });
});
