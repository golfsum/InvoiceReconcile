import { describe, expect, it } from "vitest";
import { buildReconciliationExportRows } from "@/lib/exports/reconciliation";
import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";
import type { WorkspaceDecision } from "@/lib/reconciliation/workspace-data";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    invoiceNumber: "INV-1001",
    customerName: "Northstar Studio",
    customerId: "customer-1",
    customerEmail: "ap@northstar.example",
    invoiceDate: "2026-08-01",
    dueDate: "2026-08-31",
    originalAmountMinor: 150_000,
    outstandingAmountMinor: 150_000,
    currency: "USD",
    status: "open",
    reference: "northstar-august",
    purchaseOrder: "PO-1001",
    memo: "August services",
    accountId: "receivables-us",
    sourceImportId: "invoice-import-1",
    sourceRow: 14,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment-1",
    paymentDate: "2026-08-10",
    amountMinor: 90_000,
    currency: "USD",
    payerName: "Northstar Studio LLC",
    payerId: "payer-1",
    description: "First grouped transfer",
    bankReference: "BANK-1",
    achId: "ACH-1",
    wireId: "WIRE-1",
    memo: "INV-1001 part one",
    transactionId: "TXN-1",
    accountId: "operating-us",
    sourceImportId: "payment-import-1",
    sourceRow: 21,
    ...overrides,
  };
}

function match(overrides: Partial<ProposedMatch> = {}): ProposedMatch {
  return {
    id: "match-1",
    paymentIds: ["payment-1"],
    invoiceIds: ["invoice-1"],
    candidateInvoiceIds: ["invoice-2"],
    confidence: "review",
    method: "grouped_payments",
    paymentAmountMinor: 150_000,
    invoiceAmountMinor: 150_000,
    appliedAmountMinor: 150_000,
    discrepancyMinor: 0,
    remainingInvoiceBalanceMinor: 0,
    unappliedPaymentMinor: 0,
    requiresConfirmation: true,
    reasons: ["Two deposits combine to the invoice balance", "Customer identity agrees"],
    evidence: [
      { code: "amount_combined", strength: "strong", message: "Combined amount is exact", value: 150_000 },
      { code: "name_exact", strength: "supporting", message: "Payer and customer agree" },
    ],
    ...overrides,
  };
}

function exportedRecord(rows: unknown[][]) {
  const headers = rows[0] as string[];
  const values = rows[1] as unknown[];
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

describe("reconciliation detail export", () => {
  it("preserves every grouped payment and every proposed invoice record", () => {
    const payments = [
      payment(),
      payment({
        id: "payment-2",
        paymentDate: "2026-08-11",
        amountMinor: 60_000,
        payerId: "payer-2",
        description: "Second grouped transfer",
        bankReference: "BANK-2",
        achId: "ACH-2",
        wireId: undefined,
        memo: "INV-1001 part two",
        transactionId: "TXN-2",
        sourceImportId: "payment-import-2",
        sourceRow: 33,
      }),
    ];
    const invoices = [
      invoice(),
      invoice({
        id: "invoice-2",
        invoiceNumber: "INV-1002",
        customerName: "Northstar Studio West",
        sourceImportId: "invoice-import-2",
        sourceRow: 15,
      }),
    ];
    const rows = buildReconciliationExportRows({
      matches: [match({ paymentIds: ["payment-1", "payment-2"], candidateInvoiceIds: ["invoice-2", "missing-invoice"] })],
      invoices,
      payments,
    });
    const record = exportedRecord(rows);

    expect(rows[1]).toHaveLength(rows[0].length);
    expect(record["Payment IDs"]).toBe("payment-1 | payment-2");
    expect(record["Payment transaction IDs"]).toBe("TXN-1 | TXN-2");
    expect(record["Payment source import IDs"]).toBe("payment-import-1 | payment-import-2");
    expect(JSON.parse(record["Payment details (JSON, minor units)"] as string)).toEqual([
      expect.objectContaining({ id: "payment-1", amountMinor: 90_000, transactionId: "TXN-1", achId: "ACH-1", wireId: "WIRE-1", sourceRow: 21 }),
      expect.objectContaining({ id: "payment-2", amountMinor: 60_000, transactionId: "TXN-2", achId: "ACH-2", sourceImportId: "payment-import-2", sourceRow: 33 }),
    ]);
    expect(record["Suggested invoice IDs"]).toBe("invoice-1");
    expect(JSON.parse(record["Suggested invoice details (JSON, minor units)"] as string)).toEqual([
      expect.objectContaining({ id: "invoice-1", customerEmail: "ap@northstar.example", originalAmountMinor: 150_000, sourceImportId: "invoice-import-1" }),
    ]);
    expect(record["Candidate invoice IDs"]).toBe("invoice-2 | missing-invoice");
    expect(record["Candidate invoice numbers"]).toBe("INV-1002 | ");
    expect(JSON.parse(record["Candidate invoice details (JSON, minor units)"] as string)).toEqual([
      expect.objectContaining({ id: "invoice-2", invoiceNumber: "INV-1002", sourceImportId: "invoice-import-2" }),
      { id: "missing-invoice", unavailable: true },
    ]);
    expect(record.Reasons).toBe("Two deposits combine to the invoice balance | Customer identity agrees");
    expect(JSON.parse(record["Evidence (JSON)"] as string)).toEqual(match().evidence);
  });

  it("keeps the proposal separate from the saved decision and exports decision amounts", () => {
    const decision: WorkspaceDecision = {
      matchId: "match-1",
      outcome: "confirmed",
      invoiceIds: ["invoice-2"],
      note: "Apply to the corrected invoice and retain the fee.",
      feeMinor: 15_000,
      appliedAmountMinor: 485_000,
      feedback: "incorrect",
      decidedAt: "2026-08-23T18:30:00.000Z",
    };
    const record = exportedRecord(buildReconciliationExportRows({
      matches: [match({
        paymentAmountMinor: 500_000,
        invoiceAmountMinor: 500_000,
        appliedAmountMinor: 500_000,
        remainingInvoiceBalanceMinor: 0,
      })],
      invoices: [invoice(), invoice({ id: "invoice-2", invoiceNumber: "INV-2002", outstandingAmountMinor: 15_000 })],
      payments: [payment({ amountMinor: 500_000 })],
      decisions: { "match-1": decision },
    }));

    expect(record["Suggested invoice IDs"]).toBe("invoice-1");
    expect(record["Decision invoice IDs"]).toBe("invoice-2");
    expect(record["Decision invoice numbers"]).toBe("INV-2002");
    expect(JSON.parse(record["Decision invoice details (JSON, minor units)"] as string)).toEqual([
      expect.objectContaining({ id: "invoice-2", invoiceNumber: "INV-2002", currentOutstandingAmountMinor: 15_000 }),
    ]);
    expect(record["Proposed applied amount"]).toBe(5_000);
    expect(record["Confirmed applied amount"]).toBe(4_850);
    expect(record["Known unapplied payment amount"]).toBe(150);
    expect(record["Recorded fee or deduction"]).toBe(150);
    expect(record["Current decision invoice outstanding amount"]).toBe(150);
    expect(record["Review note"]).toBe("Apply to the corrected invoice and retain the fee.");
    expect(record["Match feedback"]).toBe("incorrect");
    expect(record["Decision date"]).toBe("2026-08-23T18:30:00.000Z");
  });

  it("leaves confirmed amounts blank when a local decision did not record them", () => {
    const record = exportedRecord(buildReconciliationExportRows({
      matches: [match()],
      invoices: [invoice()],
      payments: [payment({ amountMinor: 150_000 })],
      decisions: {
        "match-1": {
          matchId: "match-1",
          outcome: "confirmed",
          invoiceIds: ["invoice-1"],
          decidedAt: "2026-08-23T19:00:00.000Z",
        },
      },
    }));

    expect(record["Proposed applied amount"]).toBe(1_500);
    expect(record["Confirmed applied amount"]).toBe("");
    expect(record["Known unapplied payment amount"]).toBe("");
  });
});
