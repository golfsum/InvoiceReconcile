import { describe, expect, it } from "vitest";
import {
  nameSimilarity,
  normalizeEntityName,
  reconcile,
  type Invoice,
  type Payment,
} from "../../src/lib/reconciliation";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    invoiceNumber: "INV-10487",
    customerName: "Acme Consulting LLC",
    customerId: "customer-1",
    invoiceDate: "2026-06-01",
    dueDate: "2026-07-01",
    originalAmountMinor: 125_000,
    outstandingAmountMinor: 125_000,
    currency: "USD",
    status: "open",
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment-1",
    paymentDate: "2026-06-05",
    amountMinor: 125_000,
    currency: "USD",
    payerName: "ACME CONSULT",
    description: "ACH ACME INC INV10487",
    transactionId: "TXN-1",
    ...overrides,
  };
}

describe("deterministic reconciliation", () => {
  it("creates an exact one-to-one match with traceable evidence", () => {
    const result = reconcile([invoice()], [payment()]);
    expect(result.matches[0]).toMatchObject({
      confidence: "exact",
      method: "reference_match",
      invoiceIds: ["invoice-1"],
      discrepancyMinor: 0,
    });
    expect(result.matches[0].evidence.map((item) => item.code)).toEqual(expect.arrayContaining(["amount_exact", "reference_exact", "date_close"]));
  });

  it("finds an invoice number embedded in a bank memo", () => {
    const result = reconcile(
      [invoice({ customerName: "Different Remitter Name" })],
      [payment({ payerName: "Third Party Treasury", description: "WIRE FOR INV-10487" })],
    );
    expect(result.matches[0].method).toBe("reference_match");
    expect(result.matches[0].confidence).toBe("exact");
  });

  it("normalizes legal suffixes, punctuation, case and shortened names", () => {
    expect(normalizeEntityName("ABC Consulting, LLC")).toBe("ABC CONSULTING");
    expect(nameSimilarity("ABC CONSULT", "ABC Consulting LLC")).toBeGreaterThanOrEqual(0.68);
    const result = reconcile(
      [invoice({ customerName: "ABC Consulting LLC", invoiceNumber: "INV-1" })],
      [payment({ payerName: "ABC CONSULT", description: "ACH CREDIT", amountMinor: 125_000 })],
    );
    expect(result.matches[0]).toMatchObject({ method: "exact_one_to_one", confidence: "high_confidence" });
  });

  it("uses an active payer mapping as visible identity evidence without skipping confirmation", () => {
    const invoices = [
      invoice({ id: "invoice-acme", invoiceNumber: "INV-A", customerName: "Acme Consulting LLC" }),
      invoice({ id: "invoice-beta", invoiceNumber: "INV-B", customerName: "Beta Supply LLC", customerId: "customer-2" }),
    ];
    const mappedPayment = payment({ payerName: "ZXQ TREASURY", description: "MONTHLY PAYMENT" });

    expect(reconcile(invoices, [mappedPayment]).matches[0]).toMatchObject({
      method: "ambiguous",
      confidence: "review",
    });

    const result = reconcile(invoices, [mappedPayment], {}, { payerMappings: [{
      id: "rule-1",
      alias: "ZXQ TREASURY",
      normalizedAlias: "ZXQ TREASURY",
      customerId: "database-customer-1",
      customerName: "Acme Consulting LLC",
    }] });
    expect(result.matches[0]).toMatchObject({
      method: "exact_one_to_one",
      confidence: "high_confidence",
      invoiceIds: ["invoice-acme"],
      requiresConfirmation: true,
    });
    expect(result.matches[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "payer_mapping_exact", value: "Acme Consulting LLC" }),
    ]));
  });

  it("does not let a payer mapping bypass date or currency controls", () => {
    const payerMappings = [{
      id: "rule-1",
      alias: "Parent Treasury",
      normalizedAlias: "PARENT TREASURY",
      customerId: "database-customer-1",
      customerName: "Acme Consulting LLC",
    }];
    const outsideDate = reconcile(
      [invoice()],
      [payment({ payerName: "Parent Treasury", description: "PAYMENT", paymentDate: "2026-12-01" })],
      { dateWindowDays: 30 },
      { payerMappings },
    );
    expect(outsideDate.matches[0]).toMatchObject({ method: "unmatched", appliedAmountMinor: 0 });

    const wrongCurrency = reconcile(
      [invoice({ currency: "EUR" })],
      [payment({ payerName: "Parent Treasury", description: "PAYMENT", currency: "USD" })],
      {},
      { payerMappings },
    );
    expect(wrongCurrency.matches[0]).toMatchObject({
      method: "currency_mismatch",
      confidence: "unmatched",
      appliedAmountMinor: 0,
    });
  });

  it("does not retarget a different customer that happens to share the same name", () => {
    const result = reconcile(
      [invoice({ customerId: "ACME-002", customerName: "Acme Consulting LLC" })],
      [payment({ payerName: "Parent Treasury", description: "PAYMENT" })],
      {},
      { payerMappings: [{
        id: "rule-1",
        alias: "Parent Treasury",
        normalizedAlias: "PARENT TREASURY",
        customerId: "database-customer-1",
        customerExternalId: "ACME-001",
        customerName: "Acme Consulting LLC",
      }] },
    );
    expect(result.matches[0]).toMatchObject({ method: "exact_one_to_one", confidence: "review" });
    expect(result.matches[0].evidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "payer_mapping_exact" }),
    ]));
  });

  it("uses the configured date window and records date proximity", () => {
    const near = reconcile(
      [invoice({ invoiceNumber: "A-100", customerName: "Alpha" })],
      [payment({ description: "deposit", payerName: "Alpha", paymentDate: "2026-06-09" })],
      { dateWindowDays: 10 },
    );
    expect(near.matches[0].evidence.some((item) => item.code === "date_close" && item.value === 8)).toBe(true);

    const outside = reconcile(
      [invoice({ invoiceNumber: "A-100", customerName: "Alpha" })],
      [payment({ description: "deposit", payerName: "Alpha", paymentDate: "2026-07-01" })],
      { dateWindowDays: 10 },
    );
    expect(outside.matches[0].method).toBe("unmatched");
  });

  it("suggests a partial payment and keeps the remaining balance", () => {
    const result = reconcile(
      [invoice({ originalAmountMinor: 500_000, outstandingAmountMinor: 500_000 })],
      [payment({ amountMinor: 250_000 })],
    );
    expect(result.matches[0]).toMatchObject({
      method: "partial_payment",
      confidence: "review",
      appliedAmountMinor: 250_000,
      remainingInvoiceBalanceMinor: 250_000,
      requiresConfirmation: true,
    });
  });

  it("keeps an overpayment remainder unapplied", () => {
    const result = reconcile(
      [invoice({ originalAmountMinor: 500_000, outstandingAmountMinor: 500_000 })],
      [payment({ amountMinor: 525_000 })],
    );
    expect(result.matches[0]).toMatchObject({
      method: "overpayment",
      appliedAmountMinor: 500_000,
      unappliedPaymentMinor: 25_000,
      discrepancyMinor: 25_000,
    });
  });

  it("matches one payment to an exact bounded invoice combination", () => {
    const invoices = [150_000, 122_500, 200_000, 75_000].map((amount, index) => invoice({
      id: `invoice-${index + 1}`,
      invoiceNumber: `INV-${index + 1}`,
      customerName: "Desert Bloom Marketing LLC",
      originalAmountMinor: amount,
      outstandingAmountMinor: amount,
    }));
    const result = reconcile(invoices, [payment({
      amountMinor: 472_500,
      payerName: "DESERT BLOOM MARKETING",
      description: "ACH FOR INV-1 INV-2 INV-3",
    })]);
    expect(result.matches[0]).toMatchObject({
      method: "combined_invoices",
      paymentAmountMinor: 472_500,
      invoiceAmountMinor: 472_500,
    });
    expect(result.matches[0].invoiceIds).toHaveLength(3);
  });

  it("groups several payments that completely settle one invoice", () => {
    const payments = [300_000, 300_000, 400_000].map((amountMinor, index) => payment({
      id: `payment-${index + 1}`,
      transactionId: `TXN-${index + 1}`,
      amountMinor,
      payerName: "Harborlight Consulting",
      description: "Installment INV-100",
    }));
    const result = reconcile([invoice({
      invoiceNumber: "INV-100",
      customerName: "Harborlight Consulting LLC",
      originalAmountMinor: 1_000_000,
      outstandingAmountMinor: 1_000_000,
    })], payments);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ method: "grouped_payments", appliedAmountMinor: 1_000_000 });
    expect(result.matches[0].paymentIds).toHaveLength(3);
  });

  it("marks a small short payment as a possible fee or deduction", () => {
    const result = reconcile(
      [invoice({ originalAmountMinor: 500_000, outstandingAmountMinor: 500_000 })],
      [payment({ amountMinor: 485_000 })],
    );
    expect(result.matches[0]).toMatchObject({
      method: "possible_fee_or_deduction",
      confidence: "review",
      discrepancyMinor: -15_000,
      remainingInvoiceBalanceMinor: 15_000,
    });
    expect(result.matches[0].reasons.join(" ")).toContain("requires confirmation");
  });

  it("detects a duplicate payment and excludes it from allocation", () => {
    const result = reconcile([invoice()], [payment(), payment({ id: "payment-copy" })]);
    expect(result.duplicatePayments).toEqual([{ kind: "payment", canonicalId: "payment-1", duplicateIds: ["payment-copy"], reason: "The transactions share the same transaction ID." }]);
    expect(result.matches.filter((match) => match.method === "duplicate_payment")).toHaveLength(1);
    expect(result.matches.filter((match) => match.appliedAmountMinor > 0)).toHaveLength(1);
  });

  it("detects a duplicate invoice and does not offer both copies", () => {
    const result = reconcile([invoice(), invoice({ id: "invoice-copy" })], [payment()]);
    expect(result.duplicateInvoices[0]).toMatchObject({ canonicalId: "invoice-1", duplicateIds: ["invoice-copy"] });
    expect(result.matches.find((match) => match.appliedAmountMinor > 0)?.invoiceIds).toEqual(["invoice-1"]);
  });

  it("returns an ambiguous review when equally responsible invoices match", () => {
    const result = reconcile([
      invoice({ id: "invoice-a", invoiceNumber: "INV-A", customerName: "Acme Consulting" }),
      invoice({ id: "invoice-b", invoiceNumber: "INV-B", customerName: "Acme Consulting" }),
    ], [payment({ description: "ACH ACME", payerName: "Acme Consulting" })]);
    expect(result.matches[0]).toMatchObject({ method: "ambiguous", confidence: "review", appliedAmountMinor: 0 });
    expect(result.matches[0].candidateInvoiceIds).toEqual(["invoice-a", "invoice-b"]);
  });

  it("leaves a payment unmatched when no responsible candidate exists", () => {
    const result = reconcile(
      [invoice({ customerName: "Acme Consulting", invoiceNumber: "INV-A", outstandingAmountMinor: 500_000 })],
      [payment({ payerName: "Unrelated Company", description: "NO REMITTANCE", amountMinor: 93_700 })],
    );
    expect(result.matches[0]).toMatchObject({ method: "unmatched", confidence: "unmatched", invoiceIds: [] });
  });

  it("blocks automatic reconciliation for a currency mismatch", () => {
    const result = reconcile(
      [invoice({ currency: "EUR" })],
      [payment({ currency: "USD" })],
    );
    expect(result.matches[0]).toMatchObject({
      method: "currency_mismatch",
      confidence: "unmatched",
      appliedAmountMinor: 0,
      candidateInvoiceIds: ["invoice-1"],
    });
  });
});
