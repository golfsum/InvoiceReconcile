import { FatalError, RetryableError, getStepMetadata, sleep } from "workflow";
import { sendImportStatusEmail } from "@/lib/email/import-status";
import { mappingFromSuggestions, newestCompatibleSavedColumnMapping, suggestColumns } from "@/lib/imports";
import { readImportBytes, type ImportSourceType } from "@/lib/imports/server-file";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type SourceClaim = {
  status: "claimed";
  worker_token: string;
  source_id: string;
  workspace_id: string;
  created_by: string;
  import_kind: "invoice" | "payment";
  source_type: ImportSourceType;
  expected_byte_size: number;
  expected_sha256: string;
  storage_bucket: string;
  storage_path: string;
  requested_sheet?: string | null;
};

class SafeImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}

function sourceClaim(value: unknown): SourceClaim | { status: "already_completed" } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.status === "already_completed") return { status: "already_completed" };
  if (row.status !== "claimed"
      || typeof row.worker_token !== "string"
      || typeof row.source_id !== "string"
      || typeof row.workspace_id !== "string"
      || typeof row.created_by !== "string"
      || (row.import_kind !== "invoice" && row.import_kind !== "payment")
      || (row.source_type !== "csv" && row.source_type !== "xlsx")
      || typeof row.expected_byte_size !== "number"
      || typeof row.expected_sha256 !== "string"
      || typeof row.storage_bucket !== "string"
      || typeof row.storage_path !== "string") return null;
  return row as SourceClaim;
}

async function deliverSourceEmail(
  service: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
  claim: SourceClaim,
  event: "preview_ready" | "preview_failed",
) {
  const { data: profile, error } = await service
    .from("profiles")
    .select("email,transactional_import_emails")
    .eq("id", claim.created_by)
    .maybeSingle();
  if (error || !profile || typeof profile.email !== "string") {
    await service.rpc("worker_record_import_source_email_delivery", {
      p_source_id: claim.source_id,
      p_status: "failed",
      p_code: "profile_unavailable",
    });
    return;
  }
  if (profile.transactional_import_emails === false) {
    await service.rpc("worker_record_import_source_email_delivery", {
      p_source_id: claim.source_id,
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
  await service.rpc("worker_record_import_source_email_delivery", {
    p_source_id: claim.source_id,
    p_status: delivery.delivered ? "sent" : delivery.mode === "demo" ? "skipped" : "failed",
    p_code: delivery.delivered ? "postmark_sent" : delivery.code,
  });
}

function safeImportFailure(error: unknown) {
  if (error instanceof SafeImportError) return error;
  const code = error instanceof Error ? error.message : "import_processing_failed";
  const permanentCodes = new Set([
    "empty", "large", "type", "sheet", "too_many_rows",
    "source_size_mismatch", "source_hash_mismatch", "missing_headers",
  ]);
  const isUnsafe = code.startsWith("unsafe_csv") || code.startsWith("unsafe_xlsx") || code.startsWith("unsafe_table");
  if (isUnsafe || permanentCodes.has(code)) {
    return new SafeImportError(code, "The source failed a permanent file-safety check.", true);
  }
  return new SafeImportError("import_processing_failed", "The source could not be processed safely yet.");
}

async function processImportSource(sourceId: string) {
  "use step";

  const { stepId, attempt } = getStepMetadata();
  const service = getSupabaseServiceClient();
  if (!service) throw new FatalError("Secure import processing is not configured.");
  const { data: claimData, error: claimError } = await service.rpc(
    "worker_claim_async_import_source",
    { p_source_id: sourceId, p_step_id: stepId },
  );
  if (claimError) {
    if (claimError.code === "40001" && attempt < 4) {
      throw new RetryableError("The import source is already being claimed.", { retryAfter: attempt * 2_000 });
    }
    throw new FatalError(claimError.code === "42501"
      ? "The import is no longer authorized."
      : "The import source could not be claimed safely.");
  }
  const claim = sourceClaim(claimData);
  if (!claim) throw new FatalError("The import worker received an invalid claim.");
  if (claim.status === "already_completed") return { status: "preview_ready" as const };

  try {
    const { data: object, error: downloadError } = await service.storage
      .from(claim.storage_bucket)
      .download(claim.storage_path);
    if (downloadError || !object) throw new SafeImportError("source_download_failed", "The private source could not be downloaded.");
    if (object.size !== claim.expected_byte_size) {
      throw new SafeImportError("source_size_mismatch", "The source byte count changed after upload.", true);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const parsed = await readImportBytes({
      bytes,
      sourceType: claim.source_type,
      requestedSheet: claim.requested_sheet || undefined,
    });
    if (parsed.sha256 !== claim.expected_sha256) {
      throw new SafeImportError("source_hash_mismatch", "The source hash changed after upload.", true);
    }
    if (parsed.headers.length === 0) {
      throw new SafeImportError("missing_headers", "No source headers were found.", true);
    }

    const { data: mappingRows, error: mappingError } = await service
      .from("imports")
      .select("column_mapping")
      .eq("workspace_id", claim.workspace_id)
      .eq("import_type", claim.import_kind === "invoice" ? "invoices" : "payments")
      .in("status", ["completed", "completed_with_errors"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (mappingError) throw new SafeImportError("mapping_history_unavailable", "Saved mappings could not be checked safely.");
    const suggestions = suggestColumns(parsed.headers, claim.import_kind);
    const savedMapping = newestCompatibleSavedColumnMapping(
      Array.isArray(mappingRows) ? mappingRows.map((row) => row.column_mapping) : [],
      parsed.headers,
      claim.import_kind,
    );
    const mapping = savedMapping || mappingFromSuggestions(suggestions);
    const rowCount = parsed.rows.reduce((count, row) => (
      Object.values(row).some((value) => String(value ?? "").trim()) ? count + 1 : count
    ), 0);
    const issueSummary = parsed.parseIssues.slice(0, 20).map((issue) => ({
      code: issue.code,
      ...(typeof issue.row === "number" ? { row: issue.row } : {}),
    }));
    const { error: completeError } = await service.rpc("worker_complete_async_import_preview", {
      p_source_id: claim.source_id,
      p_step_id: stepId,
      p_worker_token: claim.worker_token,
      p_observed_byte_size: bytes.byteLength,
      p_observed_sha256: parsed.sha256,
      p_source_headers: parsed.headers,
      p_row_count: rowCount,
      p_sheet_names: parsed.sheets,
      p_selected_sheet: parsed.selectedSheet || null,
      p_suggested_mapping: mapping,
      p_mapping_source: savedMapping ? "saved" : "detected",
      p_issue_summary: issueSummary,
    });
    if (completeError) throw new SafeImportError(
      completeError.code === "42501" ? "worker_claim_expired" : "preview_commit_failed",
      "The safe preview could not be committed.",
      completeError.code === "42501",
    );
    await deliverSourceEmail(service, claim, "preview_ready");
    return { status: "preview_ready" as const };
  } catch (error) {
    const failure = safeImportFailure(error);
    if (!failure.permanent && attempt < 4) {
      throw new RetryableError(failure.message, { retryAfter: Math.min(30_000, attempt * attempt * 2_000) });
    }
    await service.rpc("worker_fail_async_import_source", {
      p_source_id: claim.source_id,
      p_step_id: stepId,
      p_worker_token: claim.worker_token,
      p_error_code: failure.code,
      p_error_message: failure.permanent
        ? "The source did not pass the required file-safety checks."
        : "The source could not be processed after multiple safe retries.",
    });
    await deliverSourceEmail(service, claim, "preview_failed");
    return { status: "failed" as const, code: failure.code };
  }
}

processImportSource.maxRetries = 3;

async function cleanupImportSource(sourceId: string, forceRetention: boolean) {
  "use step";

  const service = getSupabaseServiceClient();
  if (!service) return { deleted: false, retry: true };
  const { data, error } = await service.rpc("worker_cleanup_async_import_source", {
    p_source_id: sourceId,
    p_force_retention: forceRetention,
  });
  if (error) return { deleted: false, retry: true };
  const result = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (result?.deleted === true) return { deleted: true, retry: false };
  if (!result || result.delete_object !== true) {
    const retry = result?.status === "upload_capability_active"
      || (forceRetention
        && (result?.status === "active_preview_claim" || result?.status === "active_reconciliation_claim"));
    return { deleted: false, retry };
  }
  if (typeof result.storage_bucket !== "string" || typeof result.storage_path !== "string") {
    await service.rpc("worker_record_async_import_source_delete_retry", {
      p_source_id: sourceId,
      p_error_code: "invalid_cleanup_claim",
    });
    return { deleted: false, retry: true };
  }
  const { error: removeError } = await service.storage
    .from(result.storage_bucket)
    .remove([result.storage_path]);
  if (removeError) {
    await service.rpc("worker_record_async_import_source_delete_retry", {
      p_source_id: sourceId,
      p_error_code: "storage_remove_failed",
    });
    return { deleted: false, retry: true };
  }
  const { error: confirmError } = await service.rpc("worker_confirm_async_import_source_deleted", {
    p_source_id: sourceId,
  });
  if (confirmError) {
    await service.rpc("worker_record_async_import_source_delete_retry", {
      p_source_id: sourceId,
      p_error_code: "deletion_receipt_failed",
    });
    return { deleted: false, retry: true };
  }
  return { deleted: true, retry: false };
}

export async function importSourcePreviewWorkflow(sourceId: string) {
  "use workflow";
  const result = await processImportSource(sourceId);
  if (result.status === "failed") {
    let cleanup = await cleanupImportSource(sourceId, false);
    while (!cleanup.deleted && cleanup.retry) {
      await sleep("10m");
      cleanup = await cleanupImportSource(sourceId, false);
    }
  }
  return result;
}

export async function importSourceLifecycleWorkflow(sourceId: string) {
  "use workflow";
  await Promise.all([
    sleep("3h").then(async () => {
      let cleanup = await cleanupImportSource(sourceId, false);
      while (!cleanup.deleted && cleanup.retry) {
        await sleep("30m");
        cleanup = await cleanupImportSource(sourceId, false);
      }
    }),
    sleep("24h").then(async () => {
      let cleanup = await cleanupImportSource(sourceId, true);
      while (!cleanup.deleted) {
        await sleep("30m");
        cleanup = await cleanupImportSource(sourceId, true);
      }
    }),
  ]);
  return { status: "retention_checked" as const };
}

export async function importSourceDeletionWorkflow(sourceId: string) {
  "use workflow";
  let cleanup = await cleanupImportSource(sourceId, true);
  while (!cleanup.deleted) {
    await sleep("10m");
    cleanup = await cleanupImportSource(sourceId, true);
  }
  return { status: "deleted" as const };
}
