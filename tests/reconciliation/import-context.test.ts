import { describe, expect, it } from "vitest";
import {
  applyCanonicalImportContext,
  parseCanonicalImportContext,
} from "../../src/lib/reconciliation/import-context";
import {
  canonicalInvoiceIdentity,
  canonicalPaymentIdentity,
} from "../../src/lib/reconciliation/identity";
import type { Invoice, Payment } from "../../src/lib/reconciliation/types";

const invoice: Invoice = {
  id: "invoice-current-file",
  invoiceNumber: " inv-10487 ",
  customerName: "Acme Consulting, LLC",
  invoiceDate: "2026-07-01",
  originalAmountMinor: 100_000,
  outstandingAmountMinor: 100_000,
  currency: "USD",
  status: "open",
};

function payment(id: string, overrides: Partial<Payment> = {}): Payment {
  return {
    id,
    paymentDate: "2026-07-02",
    amountMinor: 100_000,
    currency: "USD",
    payerName: "Acme Consulting LLC",
    transactionId: `tx-${id}`,
    ...overrides,
  };
}

describe("canonical cross-file import context", () => {
  it("uses stable identities for cumulative invoice rows and source transactions", () => {
    expect(canonicalInvoiceIdentity(invoice)).toBe(
      canonicalInvoiceIdentity({
        ...invoice,
        invoiceNumber: "INV 10487",
        customerName: "ACME CONSULTING INC.",
      }),
    );
    expect(canonicalPaymentIdentity(payment("one", { transactionId: " Tx-42 " }))).toBe(
      canonicalPaymentIdentity(payment("two", {
        transactionId: "TX42",
        paymentDate: "2026-08-30",
        amountMinor: 1,
      })),
    );
    expect(canonicalPaymentIdentity(payment("one", {
      transactionId: undefined,
      bankReference: undefined,
      achId: "ACH-900",
    }))).toContain(":ACH900:");
    expect(canonicalInvoiceIdentity({ ...invoice, accountId: "AR-US" })).not.toBe(
      canonicalInvoiceIdentity({ ...invoice, accountId: "AR-CA" }),
    );
    expect(canonicalPaymentIdentity(payment("one", { transactionId: "TX-42", accountId: "BANK-A" }))).not.toBe(
      canonicalPaymentIdentity(payment("one", { transactionId: "TX-42", accountId: "BANK-B" })),
    );
  });

  it("carries unresolved balances, excludes handled payments, and reports only new usage", () => {
    const payments = [
      payment("new"),
      payment("partial"),
      payment("resolved"),
      payment("ignored"),
    ];
    const context = parseCanonicalImportContext({
      invoice_states: [{
        client_id: invoice.id,
        outstanding_amount_minor: 40_000,
        status: "partially_paid",
      }],
      payment_states: [
        { client_id: "partial", unapplied_amount_minor: 35_000, status: "partially_applied" },
        { client_id: "resolved", unapplied_amount_minor: 0, status: "reconciled" },
        { client_id: "ignored", unapplied_amount_minor: 100_000, status: "ignored" },
      ],
    });
    expect(context).not.toBeNull();

    const applied = applyCanonicalImportContext([invoice], payments, context!);
    expect(applied).not.toBeNull();
    expect(applied?.invoices[0]).toMatchObject({
      outstandingAmountMinor: 40_000,
      status: "partially_paid",
    });
    expect(applied?.payments.map(({ id, amountMinor }) => ({ id, amountMinor }))).toEqual([
      { id: "new", amountMinor: 100_000 },
      { id: "partial", amountMinor: 35_000 },
    ]);
    expect(applied).toMatchObject({
      newPaymentCount: 1,
      carriedPaymentIds: ["partial"],
      excludedPaymentIds: ["resolved", "ignored"],
    });
  });

  it("fails closed when the database context references a row outside this upload", () => {
    const context = parseCanonicalImportContext({
      invoice_states: [],
      payment_states: [{ client_id: "not-in-upload", unapplied_amount_minor: 1, status: "unmatched" }],
    });
    expect(context).not.toBeNull();
    expect(applyCanonicalImportContext([invoice], [payment("new")], context!)).toBeNull();
  });

  it("rejects duplicate or legacy context records", () => {
    expect(parseCanonicalImportContext({
      invoice_states: [],
      payment_states: [
        { client_id: "payment-1", unapplied_amount_minor: 100, status: "unmatched" },
        { client_id: "payment-1", unapplied_amount_minor: 100, status: "unmatched" },
      ],
    })).toBeNull();
    expect(parseCanonicalImportContext({ invoice_states: [], existing_payment_ids: [] })).toBeNull();
  });
});
