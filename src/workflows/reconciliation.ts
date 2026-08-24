import { FatalError, RetryableError, getStepMetadata, sleep } from "workflow";
import { sendImportStatusEmail } from "@/lib/email/import-status";
import {
  fingerprintImport,
  normalizeInvoiceRows,
  normalizePaymentRows,
  type ColumnMapping,
} from "@/lib/imports";
import { readImportBytes, type ImportSourceType, type ParsedImportSource } from "@/lib/imports/server-file";
import { reconcile } from "@/lib/reconciliation";
import { applyCanonicalImportContext, parseCanonicalImportContext } from "@/lib/reconciliation/import-context";
import { buildDurableImport, reconciliationRunKey } from "@/lib/reconciliation/persistence";
import { loadWorkspaceMatchingRuleCatalog, workspaceRuleRuntime } from "@/lib/reconciliation/workspace-rules";
import { parseWorkspaceReconciliationDefaults } from "@/lib/reconciliation/workspace-defaults";
import { RECONCILIATION_ENGINE_VERSION, type StoredWorkspaceData } from "@/lib/reconciliation/workspace-data";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type ClaimedSource = {
  id: string;
  source_type: ImportSourceType;
  expected_byte_size: number;
  expected_sha256: string;
  storage_bucket: string;
  storage_path: string;
  selected_sheet?: string | null;
};

type ReconciliationClaim = {
  status: "claimed";
  worker_token: string;
  request_id: string;
  workspace_id: string;
  submitted_by: string;
  invoice_mapping: ColumnMapping;
  payment_mapping: ColumnMapping;
  invoice_source: ClaimedSource;
  payment_source: ClaimedSource;
};

class SafeReconciliationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function claimedSource(value: unknown): ClaimedSource | null {
  if (!isRecord(value)
      || typeof value.id !== "string"
      || (value.source_type !== "csv" && value.source_type !== "xlsx")
      || typeof value.expected_byte_size !== "number"
      || typeof value.expected_sha256 !== "string"
      || typeof value.storage_bucket !== "string"
      || typeof value.storage_path !== "string"
      || (value.selected_sheet !== null && value.selected_sheet !== undefined && typeof value.selected_sheet !== "string")) return null;
  return value as ClaimedSource;
}

function columnMapping(value: unknown): ColumnMapping | null {
  if (!isRecord(value) || Object.values(value).some((header) => typeof header !== "string")) return null;
  return value as ColumnMapping;
}

type ReconciliationEmailContext = Pick<ReconciliationClaim, "request_id" | "workspace_id" | "submitted_by">;

function reconciliationClaim(value: unknown): ReconciliationClaim
  | { status: "already_completed"; summary?: unknown }
  | ({ status: "plan_capacity_rejected" } & ReconciliationEmailContext)
  | null {
  if (!isRecord(value)) return null;
  if (value.status === "already_completed") return { status: "already_completed", summary: value.summary };
  if (value.status === "plan_capacity_rejected"
      && typeof value.request_id === "string"
      && typeof value.workspace_id === "string"
      && typeof value.submitted_by === "string") {
    return {
      status: "plan_capacity_rejected",
      request_id: value.request_id,
      workspace_id: value.workspace_id,
      submitted_by: value.submitted_by,
    };
  }
  const invoiceSource = claimedSource(value.invoice_source);
  const paymentSource = claimedSource(value.payment_source);
  const invoiceMapping = columnMapping(value.invoice_mapping);
  const paymentMapping = columnMapping(value.payment_mapping);
  if (value.status !== "claimed"
      || typeof value.worker_token !== "string"
      || typeof value.request_id !== "string"
      || typeof value.workspace_id !== "string"
      || typeof value.submitted_by !== "string"
      || !invoiceSource || !paymentSource || !invoiceMapping || !paymentMapping) return null;
  return {
    status: "claimed",
    worker_token: value.worker_token,
    request_id: value.request_id,
    workspace_id: value.workspace_id,
    submitted_by: value.submitted_by,
    invoice_mapping: invoiceMapping,
    payment_mapping: paymentMapping,
    invoice_source: invoiceSource,
    payment_source: paymentSource,
  };
}

async function deliverReconciliationEmail(
  service: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
  claim: ReconciliationEmailContext,
  event: "reconciliation_ready" | "reconciliation_failed",
) {
  const { data: profile, error } = await service
    .from("profiles")
    .select("email,transactional_import_emails")
    .eq("id", claim.submitted_by)
    .maybeSingle();
  if (error || !profile || typeof profile.email !== "string") {
    await service.rpc("worker_record_reconciliation_email_delivery", {
      p_request_id: claim.request_id,
      p_status: "failed",
      p_code: "profile_unavailable",
    });
    return;
  }
  if (profile.transactional_import_emails === false) {
    await service.rpc("worker_record_reconciliation_email_delivery", {
      p_request_id: claim.request_id,
      p_status: "skipped",
      p_code: "user_opted_out",
    });
    return;
  }
  const delivery = await sendImportStatusEmail({
    to: profile.email,
    workspaceId: claim.workspace_id,
    event,
  });
  await service.rpc("worker_record_reconciliation_email_delivery", {
    p_request_id: claim.request_id,
    p_status: delivery.delivered ? "sent" : delivery.mode === "demo" ? "skipped" : "failed",
    p_code: delivery.delivered ? "postmark_sent" : delivery.code,
  });
}

async function downloadAndRead(
  service: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
  source: ClaimedSource,
): Promise<ParsedImportSource> {
  const { data: object, error } = await service.storage
    .from(source.storage_bucket)
    .download(source.storage_path);
  if (error || !object) throw new SafeReconciliationError("source_download_failed", "A private source could not be downloaded.");
  if (object.size !== source.expected_byte_size) {
    throw new SafeReconciliationError("source_size_mismatch", "A source byte count changed after upload.", true);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const parsed = await readImportBytes({
    bytes,
    sourceType: source.source_type,
    requestedSheet: source.selected_sheet || undefined,
  });
  if (parsed.sha256 !== source.expected_sha256) {
    throw new SafeReconciliationError("source_hash_mismatch", "A source hash changed after upload.", true);
  }
  return parsed;
}

function safeFailure(error: unknown) {
  if (error instanceof SafeReconciliationError) return error;
  const code = error instanceof Error ? error.message : "reconciliation_processing_failed";
  const permanent = code === "empty" || code === "large" || code === "sheet"
    || code === "too_many_rows" || code.startsWith("unsafe_csv") || code.startsWith("unsafe_xlsx") || code.startsWith("unsafe_table");
  return new SafeReconciliationError(
    permanent ? code : "reconciliation_processing_failed",
    permanent
      ? "A source failed a permanent file-safety check."
      : "The reconciliation could not be completed safely yet.",
    permanent,
  );
}

async function processAsyncReconciliation(requestId: string) {
  "use step";

  const { stepId, attempt } = getStepMetadata();
  const service = getSupabaseServiceClient();
  if (!service) throw new FatalError("Secure reconciliation processing is not configured.");
  const { data: claimData, error: claimError } = await service.rpc(
    "worker_claim_async_reconciliation",
    { p_request_id: requestId, p_step_id: stepId },
  );
  if (claimError) {
    if (claimError.code === "40001" && attempt < 4) {
      throw new RetryableError("The reconciliation is already being claimed.", { retryAfter: attempt * 2_000 });
    }
    throw new FatalError(claimError.code === "42501"
      ? "The reconciliation is no longer authorized."
      : "The reconciliation request could not be claimed safely.");
  }
  const claim = reconciliationClaim(claimData);
  if (!claim) throw new FatalError("The reconciliation worker received an invalid claim.");
  if (claim.status === "already_completed") return { status: "succeeded" as const, summary: claim.summary };
  if (claim.status === "plan_capacity_rejected") {
    await deliverReconciliationEmail(service, claim, "reconciliation_failed");
    return { status: "failed" as const, code: "payment_limit_exceeded" as const };
  }

  try {
    const [invoiceSource, paymentSource, workspaceResult, rules] = await Promise.all([
      downloadAndRead(service, claim.invoice_source),
      downloadAndRead(service, claim.payment_source),
      service.from("workspaces")
        .select("currency_code,match_days_before,match_days_after")
        .eq("id", claim.workspace_id)
        .maybeSingle(),
      loadWorkspaceMatchingRuleCatalog(service, claim.workspace_id),
    ]);
    if (workspaceResult.error || !workspaceResult.data) {
      throw new SafeReconciliationError("workspace_unavailable", "Workspace matching settings could not be loaded.");
    }
    const defaults = parseWorkspaceReconciliationDefaults(workspaceResult.data);
    if (!defaults || rules.status !== "ready") {
      throw new SafeReconciliationError("workspace_configuration_invalid", "Workspace matching settings are invalid.", true);
    }
    const ruleRuntime = workspaceRuleRuntime(rules.catalog);

    const invoiceResult = normalizeInvoiceRows(invoiceSource.rows, claim.invoice_mapping, {
      sourceImportId: `invoice-${invoiceSource.fingerprint}`,
      idPrefix: "invoice",
      defaultCurrency: defaults.currencyCode,
    });
    const paymentResult = normalizePaymentRows(paymentSource.rows, claim.payment_mapping, {
      sourceImportId: `payment-${paymentSource.fingerprint}`,
      idPrefix: "payment",
      defaultCurrency: defaults.currencyCode,
    });
    const normalizedInvoices = invoiceResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    const normalizedPayments = paymentResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    if (normalizedInvoices.length === 0) {
      throw new SafeReconciliationError("no_valid_invoice_rows", "No valid invoice rows remained after mapping.", true);
    }
    if (normalizedPayments.length === 0) {
      throw new SafeReconciliationError("no_valid_payment_rows", "No valid payment rows remained after mapping.", true);
    }

    const { data: contextData, error: contextError } = await service.rpc(
      "worker_get_async_reconciliation_context",
      {
        p_request_id: claim.request_id,
        p_step_id: stepId,
        p_worker_token: claim.worker_token,
        p_invoices: normalizedInvoices,
        p_payments: normalizedPayments,
      },
    );
    if (contextError) throw new SafeReconciliationError(
      contextError.code === "42501" ? "worker_claim_expired" : "canonical_context_unavailable",
      "Existing reconciliation records could not be checked safely.",
      contextError.code === "42501",
    );
    const context = parseCanonicalImportContext(contextData);
    const canonicalized = context
      ? applyCanonicalImportContext(normalizedInvoices, normalizedPayments, context)
      : null;
    if (!canonicalized) {
      throw new SafeReconciliationError("canonical_context_invalid", "Existing reconciliation state was invalid.", true);
    }

    const invoices = canonicalized.invoices;
    const payments = canonicalized.payments;
    const billablePaymentCount = canonicalized.newPaymentCount;
    const result = reconcile(invoices, payments, defaults.config, ruleRuntime.context);
    const reconciliationContext = {
      defaultCurrency: defaults.currencyCode,
      earlyPaymentAllowanceDays: defaults.config.earlyPaymentAllowanceDays,
      dateWindowDays: defaults.config.dateWindowDays,
      payerMappingFingerprint: ruleRuntime.payerMappingFingerprint,
      matchingRuleFingerprint: ruleRuntime.matchingRuleFingerprint,
    };
    const runId = reconciliationRunKey(
      invoiceSource.sha256,
      paymentSource.sha256,
      claim.invoice_mapping,
      claim.payment_mapping,
      fingerprintImport,
      reconciliationContext,
    );
    const issueCount = invoiceSource.parseIssues.length + paymentSource.parseIssues.length
      + invoiceResult.issues.length + paymentResult.issues.length;
    const snapshot: StoredWorkspaceData = {
      runId,
      completedAt: new Date().toISOString(),
      invoices,
      payments,
      usagePaymentCount: billablePaymentCount,
      result,
      importSummary: {
        invoiceRows: invoiceSource.rows.length,
        invoicesAccepted: invoices.length,
        invoicesPreviouslyImported: canonicalized.existingInvoiceIds.length,
        invoicesRejected: invoiceResult.rejected.length,
        paymentRows: paymentSource.rows.length,
        paymentsAccepted: normalizedPayments.length,
        paymentsActiveInRun: payments.length,
        paymentsNew: billablePaymentCount,
        paymentsPreviouslyImported: canonicalized.existingPaymentIds.length,
        paymentsCarriedForward: canonicalized.carriedPaymentIds.length,
        paymentsAlreadyResolved: canonicalized.excludedPaymentIds.length,
        paymentsRejected: paymentResult.rejected.length,
      },
      sourceFiles: {
        invoice: {
          name: `invoice.${claim.invoice_source.source_type}`,
          rows: invoiceSource.rows.length,
          accepted: invoices.length,
          rejected: invoiceResult.rejected.length,
        },
        payment: {
          name: `payment.${claim.payment_source.source_type}`,
          rows: paymentSource.rows.length,
          accepted: normalizedPayments.length,
          rejected: paymentResult.rejected.length,
        },
      },
      reconciliationContext,
    };
    const safeSummary = {
      invoices: invoices.length,
      payments: payments.length,
      matches: result.matches.length,
      review: result.matches.filter((match) => match.confidence === "review" || match.confidence === "unmatched").length,
      issues: issueCount,
    };
    const { data: completionData, error: completionError } = await service.rpc(
      "worker_complete_async_reconciliation",
      {
        p_request_id: claim.request_id,
        p_step_id: stepId,
        p_worker_token: claim.worker_token,
        p_run_key: runId,
        p_engine_version: RECONCILIATION_ENGINE_VERSION,
        p_billable_payment_count: billablePaymentCount,
        p_snapshot: snapshot,
        p_invoice_import: buildDurableImport({
          fileName: `invoice.${claim.invoice_source.source_type}`,
          fileSize: claim.invoice_source.expected_byte_size,
          sha256: invoiceSource.sha256,
          sheetName: invoiceSource.selectedSheet,
          headers: invoiceSource.headers,
          rows: invoiceSource.rows,
          mapping: claim.invoice_mapping,
          normalization: invoiceResult,
        }),
        p_payment_import: buildDurableImport({
          fileName: `payment.${claim.payment_source.source_type}`,
          fileSize: claim.payment_source.expected_byte_size,
          sha256: paymentSource.sha256,
          sheetName: paymentSource.selectedSheet,
          headers: paymentSource.headers,
          rows: paymentSource.rows,
          mapping: claim.payment_mapping,
          normalization: paymentResult,
        }),
        p_safe_summary: safeSummary,
      },
    );
    if (completionError) throw new SafeReconciliationError(
      completionError.code === "42501" ? "worker_claim_expired" : "reconciliation_commit_failed",
      "The reconciliation could not be committed safely.",
      completionError.code === "42501" || completionError.code === "22023",
    );
    if (!isRecord(completionData) || typeof completionData.allowed !== "boolean") {
      throw new SafeReconciliationError("reconciliation_commit_invalid", "The reconciliation commit response was invalid.", true);
    }
    if (!completionData.allowed) {
      await deliverReconciliationEmail(service, claim, "reconciliation_failed");
      return { status: "failed" as const, code: "payment_limit_exceeded" as const };
    }

    await deliverReconciliationEmail(service, claim, "reconciliation_ready");
    return { status: "succeeded" as const, summary: safeSummary };
  } catch (error) {
    const failure = safeFailure(error);
    if (!failure.permanent && attempt < 4) {
      throw new RetryableError(failure.message, { retryAfter: Math.min(30_000, attempt * attempt * 2_000) });
    }
    await service.rpc("worker_fail_async_reconciliation", {
      p_request_id: claim.request_id,
      p_step_id: stepId,
      p_worker_token: claim.worker_token,
      p_error_code: failure.code,
      p_error_message: failure.permanent
        ? "The run stopped before saving because an input failed validation."
        : "The run stopped before saving after multiple safe retries.",
    });
    await deliverReconciliationEmail(service, claim, "reconciliation_failed");
    throw new FatalError(failure.message);
  }
}

processAsyncReconciliation.maxRetries = 3;

async function cleanupCompletedReconciliationSources(requestId: string) {
  "use step";

  const service = getSupabaseServiceClient();
  if (!service) return { deleted: false };
  const { data: request, error: requestError } = await service
    .from("async_reconciliation_requests")
    .select("status,invoice_source_id,payment_source_id")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) return { deleted: false };
  if (!request) return { deleted: true };
  if (request.status !== "succeeded"
      || typeof request.invoice_source_id !== "string"
      || typeof request.payment_source_id !== "string") {
    return { deleted: false };
  }
  for (const sourceId of [request.invoice_source_id, request.payment_source_id]) {
    const { data, error } = await service.rpc("worker_cleanup_async_import_source", {
      p_source_id: sourceId,
      p_force_retention: true,
    });
    if (error || !isRecord(data)) return { deleted: false };
    if (data.deleted === true) continue;
    if (data.status === "upload_capability_active") return { deleted: false };
    if (data.delete_object !== true
        || typeof data.storage_bucket !== "string" || typeof data.storage_path !== "string") {
      await service.rpc("worker_record_async_import_source_delete_retry", {
        p_source_id: sourceId,
        p_error_code: "invalid_cleanup_claim",
      });
      return { deleted: false };
    }
    const { error: removeError } = await service.storage
      .from(data.storage_bucket)
      .remove([data.storage_path]);
    if (removeError) {
      await service.rpc("worker_record_async_import_source_delete_retry", {
        p_source_id: sourceId,
        p_error_code: "storage_remove_failed",
      });
      return { deleted: false };
    }
    const { error: confirmError } = await service.rpc("worker_confirm_async_import_source_deleted", {
      p_source_id: sourceId,
    });
    if (confirmError) {
      await service.rpc("worker_record_async_import_source_delete_retry", {
        p_source_id: sourceId,
        p_error_code: "deletion_receipt_failed",
      });
      return { deleted: false };
    }
  }
  return { deleted: true };
}

export async function asyncReconciliationWorkflow(requestId: string) {
  "use workflow";
  const result = await processAsyncReconciliation(requestId);
  if (result.status === "succeeded") {
    let cleanup = await cleanupCompletedReconciliationSources(requestId);
    while (!cleanup.deleted) {
      await sleep("10m");
      cleanup = await cleanupCompletedReconciliationSources(requestId);
    }
  }
  return result;
}
