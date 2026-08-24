import { describe, expect, it } from "vitest";
import { fingerprintImport, normalizeInvoiceRows } from "@/lib/imports";
import { buildDurableImport, reconciliationRunKey } from "@/lib/reconciliation/persistence";
import { isStoredWorkspaceData, newestWorkspaceData, type StoredWorkspaceData } from "@/lib/reconciliation/workspace-data";

describe("durable reconciliation persistence", () => {
  it("builds a complete import ledger with separate duplicate and rejected counts", () => {
    const rows = [
      { Number: "INV-1", Customer: "Acme", Date: "2026-07-01", Amount: "100" },
      { Number: "INV-1", Customer: "Acme", Date: "2026-07-01", Amount: "100" },
      { Number: "", Customer: "", Date: "", Amount: "" },
      { Number: "INV-2", Customer: "Acme", Date: "bad", Amount: "125" },
    ];
    const mapping = { invoiceNumber: "Number", customerName: "Customer", invoiceDate: "Date", originalAmount: "Amount" } as const;
    const normalization = normalizeInvoiceRows(rows, mapping);
    const durable = buildDurableImport({
      fileName: "invoices.csv",
      fileSize: 128,
      sha256: "a".repeat(64),
      headers: Object.keys(rows[0]),
      rows,
      mapping,
      normalization,
    });

    expect(durable).toMatchObject({
      sourceType: "csv",
      acceptedRows: 1,
      rejectedRows: 1,
      duplicateRows: 1,
      blankRows: 1,
      totalRows: 4,
    });
    expect(durable.rows.map((row) => row.disposition)).toEqual(["accepted", "duplicate", "blank", "rejected"]);
  });

  it("uses both file fingerprints and a stable mapping fingerprint for idempotency", () => {
    const left = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceDate: "Date", invoiceNumber: "Number" },
      { amount: "Amount", paymentDate: "Date" },
      fingerprintImport,
    );
    const reordered = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceNumber: "Number", invoiceDate: "Date" },
      { paymentDate: "Date", amount: "Amount" },
      fingerprintImport,
    );
    const changed = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceNumber: "Other", invoiceDate: "Date" },
      { paymentDate: "Date", amount: "Amount" },
      fingerprintImport,
    );
    const configured = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceDate: "Date", invoiceNumber: "Number" },
      { amount: "Amount", paymentDate: "Date" },
      fingerprintImport,
      { defaultCurrency: "CAD", earlyPaymentAllowanceDays: 3, dateWindowDays: 45 },
    );
    const configuredWithRule = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceDate: "Date", invoiceNumber: "Number" },
      { amount: "Amount", paymentDate: "Date" },
      fingerprintImport,
      { defaultCurrency: "CAD", earlyPaymentAllowanceDays: 3, dateWindowDays: 45, payerMappingFingerprint: "c".repeat(64) },
    );
    const configuredWithCustomRule = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceDate: "Date", invoiceNumber: "Number" },
      { amount: "Amount", paymentDate: "Date" },
      fingerprintImport,
      { defaultCurrency: "CAD", earlyPaymentAllowanceDays: 3, dateWindowDays: 45, payerMappingFingerprint: "c".repeat(64), matchingRuleFingerprint: "d".repeat(64) },
    );
    const configuredWithExplicitlyAbsentCustomRule = reconciliationRunKey(
      "a".repeat(64),
      "b".repeat(64),
      { invoiceDate: "Date", invoiceNumber: "Number" },
      { amount: "Amount", paymentDate: "Date" },
      fingerprintImport,
      { defaultCurrency: "CAD", earlyPaymentAllowanceDays: 3, dateWindowDays: 45, payerMappingFingerprint: "c".repeat(64), matchingRuleFingerprint: undefined },
    );
    expect(reordered).toBe(left);
    expect(changed).not.toBe(left);
    expect(configured).not.toBe(left);
    expect(configuredWithRule).not.toBe(configured);
    expect(configuredWithCustomRule).not.toBe(configuredWithRule);
    expect(configuredWithExplicitlyAbsentCustomRule).toBe(configuredWithRule);
    expect(configuredWithCustomRule).toMatch(/^[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{64}$/);
    expect(left.length).toBeLessThanOrEqual(190);
  });

  it("keeps a newer browser-local run when the last durable run is older", () => {
    const base: StoredWorkspaceData = {
      runId: "run-12345678",
      completedAt: "2026-08-23T12:00:00.000Z",
      invoices: [],
      payments: [],
      result: { matches: [], duplicatePayments: [], duplicateInvoices: [], unallocatedInvoiceIds: [] },
    };
    const local = { ...base, runId: "local-12345678", completedAt: "2026-08-23T12:05:00.000Z", persistence: { status: "local" as const } };
    const durable = { ...base, persistence: { status: "durable" as const, savedAt: "2026-08-23T12:00:00.000Z" } };
    expect(newestWorkspaceData(local, durable)).toBe(local);
    expect(isStoredWorkspaceData(durable)).toBe(true);
    expect(isStoredWorkspaceData({ ...durable, result: null })).toBe(false);
  });
});
