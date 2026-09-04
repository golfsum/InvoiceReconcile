import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { fingerprintImport } from "@/lib/imports";
import { mappingFromSuggestions, suggestColumns } from "@/lib/imports/columns";
import { normalizeInvoiceRows, normalizePaymentRows } from "@/lib/imports/normalize";
import { bundledSampleAsFile, readBundledSample } from "@/lib/imports/sample-data";
import { readUploadedImportFile } from "@/lib/imports/server-file";
import { reconcile } from "@/lib/reconciliation/engine";
import { buildDurableImport, reconciliationRunKey } from "@/lib/reconciliation/persistence";
import { RECONCILIATION_ENGINE_VERSION } from "@/lib/reconciliation/workspace-data";

const METHOD_REMAP: Record<string, string> = {
  reference_match: "invoice_reference",
  grouped_payments: "combined_payments",
  partial_payment: "partial",
  possible_fee_or_deduction: "possible_fee",
};

const ALLOWED_METHODS = new Set([
  "exact_one_to_one", "invoice_reference", "combined_invoices", "combined_payments",
  "partial", "possible_fee", "overpayment", "payer_alias", "ambiguous",
  "currency_mismatch", "unmatched", "duplicate_payment", "manual",
]);

const ALLOWED_CONFIDENCE = new Set(["exact", "high", "review", "unmatched"]);

describe("sample persist payload", () => {
  it("produces import and match values that durable persist can accept", async () => {
    const [invoiceSample, paymentSample] = await Promise.all([
      readBundledSample("invoice"),
      readBundledSample("payment"),
    ]);
    const invoiceFile = bundledSampleAsFile(invoiceSample);
    const paymentFile = bundledSampleAsFile(paymentSample);

    expect(invoiceFile.size, "invoice File.size").toBe(invoiceSample.bytes.byteLength);
    expect(paymentFile.size, "payment File.size").toBe(paymentSample.bytes.byteLength);
    expect(invoiceFile.size).toBeGreaterThan(0);
    expect(paymentFile.size).toBeGreaterThan(0);

    const [invoiceSource, paymentSource] = await Promise.all([
      readUploadedImportFile(invoiceFile),
      readUploadedImportFile(paymentFile),
    ]);
    const invoiceMapping = mappingFromSuggestions(suggestColumns(invoiceSource.headers, "invoice"));
    const paymentMapping = mappingFromSuggestions(suggestColumns(paymentSource.headers, "payment"));
    const invoiceResult = normalizeInvoiceRows(invoiceSource.rows, invoiceMapping, {
      sourceImportId: `invoice-${invoiceSource.fingerprint}`,
      idPrefix: "invoice",
      defaultCurrency: "USD",
    });
    const paymentResult = normalizePaymentRows(paymentSource.rows, paymentMapping, {
      sourceImportId: `payment-${paymentSource.fingerprint}`,
      idPrefix: "payment",
      defaultCurrency: "USD",
    });
    const invoices = invoiceResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    const payments = paymentResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    const result = reconcile(invoices, payments);
    const runId = reconciliationRunKey(
      invoiceSource.sha256,
      paymentSource.sha256,
      invoiceMapping,
      paymentMapping,
      fingerprintImport,
      { defaultCurrency: "USD", earlyPaymentAllowanceDays: 3, dateWindowDays: 90 },
    );
    const invoiceImport = buildDurableImport({
      fileName: invoiceFile.name,
      fileSize: invoiceFile.size,
      sha256: invoiceSource.sha256,
      headers: invoiceSource.headers,
      rows: invoiceSource.rows,
      mapping: invoiceMapping,
      normalization: invoiceResult,
    });
    const paymentImport = buildDurableImport({
      fileName: paymentFile.name,
      fileSize: paymentFile.size,
      sha256: paymentSource.sha256,
      headers: paymentSource.headers,
      rows: paymentSource.rows,
      mapping: paymentMapping,
      normalization: paymentResult,
    });

    expect(invoiceImport.byteSize).toBeGreaterThan(0);
    expect(paymentImport.byteSize).toBeGreaterThan(0);
    expect(invoiceImport.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(paymentImport.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(runId).toMatch(/^[A-Za-z0-9:_-]{8,190}$/);
    expect(RECONCILIATION_ENGINE_VERSION.length).toBeGreaterThan(0);

    for (const importLedger of [invoiceImport, paymentImport]) {
      expect(
        importLedger.acceptedRows + importLedger.rejectedRows + importLedger.duplicateRows + importLedger.blankRows,
      ).toBeLessThanOrEqual(importLedger.totalRows);
    }

    const snapshot = {
      runId,
      invoices,
      payments,
      usagePaymentCount: payments.length,
      result,
    };
    const serialized = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(serialized.invoices).toHaveLength(invoices.length);
    expect(serialized.payments).toHaveLength(payments.length);

    const invoiceIds = new Set(serialized.invoices.map((invoice) => invoice.id));
    const paymentIds = new Set(serialized.payments.map((payment) => payment.id));
    const violations: string[] = [];

    for (const invoice of serialized.invoices) {
      if (!["open", "partially_paid", "paid", "void"].includes(invoice.status)) {
        violations.push(`invoice status ${invoice.status}`);
      }
      if (invoice.originalAmountMinor <= 0 || invoice.outstandingAmountMinor < 0
          || invoice.outstandingAmountMinor > invoice.originalAmountMinor) {
        violations.push(`invoice amounts ${invoice.id}`);
      }
    }

    for (const match of serialized.result.matches) {
      const method = METHOD_REMAP[match.method] ?? match.method;
      const confidence = match.confidence === "high_confidence" ? "high" : match.confidence;
      if (!ALLOWED_METHODS.has(method)) violations.push(`method ${match.method}`);
      if (!ALLOWED_CONFIDENCE.has(confidence)) violations.push(`confidence ${match.confidence}`);
      if (match.paymentAmountMinor <= 0) violations.push(`payment amount ${match.id}`);
      if (match.appliedAmountMinor < 0 || match.appliedAmountMinor > match.paymentAmountMinor) {
        violations.push(`applied ${match.id} ${match.appliedAmountMinor}/${match.paymentAmountMinor}`);
      }
      for (const paymentId of match.paymentIds) {
        if (!paymentIds.has(paymentId)) violations.push(`unknown payment ${paymentId}`);
      }
      for (const invoiceId of match.invoiceIds) {
        if (!invoiceIds.has(invoiceId)) violations.push(`unknown invoice ${invoiceId}`);
      }
    }

    expect(violations, violations.join("; ")).toEqual([]);
    expect(serialized.result.matches.length).toBeGreaterThan(0);
  });
});
