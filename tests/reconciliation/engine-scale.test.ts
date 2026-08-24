import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  northstarDemoFixture,
  reconcile,
  type Invoice,
  type Payment,
} from "../../src/lib/reconciliation";

function scaleFixture(size: number): { invoices: Invoice[]; payments: Payment[] } {
  const invoices = Array.from({ length: size }, (_, index): Invoice => {
    const suffix = String(index).padStart(5, "0");
    const amountMinor = 100_000 + index;
    return {
      id: `scale-invoice-${suffix}`,
      invoiceNumber: `INV-${suffix}`,
      customerName: `Scale Customer ${suffix}`,
      customerId: `CUSTOMER-${suffix}`,
      invoiceDate: "2026-06-01",
      originalAmountMinor: amountMinor,
      outstandingAmountMinor: amountMinor,
      currency: "USD",
      status: "open",
    };
  });
  const payments = Array.from({ length: size }, (_, index): Payment => {
    const suffix = String(index).padStart(5, "0");
    return {
      id: `scale-payment-${suffix}`,
      paymentDate: "2026-06-05",
      amountMinor: 100_000 + index,
      currency: "USD",
      payerName: `Scale Customer ${suffix}`,
      payerId: `CUSTOMER-${suffix}`,
      description: `Payment for INV-${suffix}`,
      transactionId: `SCALE-TXN-${suffix}`,
    };
  });
  return { invoices, payments };
}

function crowdedFixture(size: number): { invoices: Invoice[]; payments: Payment[] } {
  const invoices = Array.from({ length: size }, (_, index): Invoice => ({
    id: `crowded-invoice-${String(index).padStart(3, "0")}`,
    invoiceNumber: `CROWDED-${index}`,
    customerName: "Shared Treasury Customer",
    invoiceDate: "2026-06-01",
    originalAmountMinor: 250_000,
    outstandingAmountMinor: 250_000,
    currency: "USD",
    status: "open",
  }));
  const payments = Array.from({ length: size }, (_, index): Payment => ({
    id: `crowded-payment-${String(index).padStart(3, "0")}`,
    paymentDate: "2026-06-05",
    amountMinor: 250_000,
    currency: "USD",
    payerName: "Shared Treasury Customer",
    description: index === 0 ? "Consolidated payment for CROWDED-0" : "Consolidated treasury payment",
    transactionId: `CROWDED-TXN-${index}`,
  }));
  return { invoices, payments };
}

describe("matching engine scale safeguards", () => {
  it("preserves the complete Northstar result and evidence payload", () => {
    const result = reconcile(
      [...northstarDemoFixture.invoices],
      [...northstarDemoFixture.payments],
    );
    const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    expect(digest).toBe("1f38a04f495df68b740fd90846a11285b652cc49ef58ed745051b6a8a6eab9b8");
  });

  it("preserves the complete payer-mapping result and evidence payload", () => {
    const invoices: Invoice[] = [
      {
        id: "invoice-acme",
        invoiceNumber: "INV-A",
        customerName: "Acme Consulting LLC",
        customerId: "customer-1",
        invoiceDate: "2026-06-01",
        originalAmountMinor: 125_000,
        outstandingAmountMinor: 125_000,
        currency: "USD",
        status: "open",
      },
      {
        id: "invoice-beta",
        invoiceNumber: "INV-B",
        customerName: "Beta Supply LLC",
        customerId: "customer-2",
        invoiceDate: "2026-06-01",
        originalAmountMinor: 125_000,
        outstandingAmountMinor: 125_000,
        currency: "USD",
        status: "open",
      },
    ];
    const payments: Payment[] = [{
      id: "payment-1",
      paymentDate: "2026-06-05",
      amountMinor: 125_000,
      currency: "USD",
      payerName: "ZXQ TREASURY",
      description: "MONTHLY PAYMENT",
      transactionId: "TXN-1",
    }];
    const result = reconcile(invoices, payments, {}, { payerMappings: [{
      id: "rule-1",
      alias: "ZXQ TREASURY",
      normalizedAlias: "ZXQ TREASURY",
      customerId: "database-customer-1",
      customerName: "Acme Consulting LLC",
    }] });
    const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    expect(digest).toBe("4a108f0637e2c1809b1734f809d41e5daea5456c17fa1eab4cf100eb1503a701");
  });

  it("reconciles 5,000 invoices and payments within the 30 second release budget", { timeout: 30_000 }, () => {
    const fixture = scaleFixture(5_000);
    const startedAt = performance.now();
    const result = reconcile(fixture.invoices, fixture.payments);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result.matches).toHaveLength(5_000);
    expect(result.matches.every((match) => match.appliedAmountMinor > 0)).toBe(true);
    expect(result.unallocatedInvoiceIds).toEqual([]);
    expect(elapsedMilliseconds).toBeLessThan(30_000);
  });

  it("returns bounded review items when same-date and same-currency candidates exceed the budget", () => {
    const fixture = crowdedFixture(12);
    const result = reconcile(fixture.invoices, fixture.payments, {
      candidateEvaluationLimit: 8,
      candidateEvidenceLimit: 3,
    });

    expect(result.matches).toHaveLength(12);
    expect(result.matches.every((match) =>
      match.method === "ambiguous"
      && match.confidence === "review"
      && match.appliedAmountMinor === 0
      && match.candidateInvoiceIds?.length === 3
      && match.evidence.some((evidence) =>
        evidence.code === "candidate_limit_exceeded"
        && evidence.value === 9))).toBe(true);
    expect(result.unallocatedInvoiceIds).toHaveLength(12);
  });
});
