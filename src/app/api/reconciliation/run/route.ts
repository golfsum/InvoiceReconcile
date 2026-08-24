import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fingerprintImport,
  normalizeInvoiceRows,
  normalizePaymentRows,
  uploadSafetyMessage,
} from "@/lib/imports";
import { readUploadedImportFile, requestedColumnMapping } from "@/lib/imports/server-file";
import { reconcile } from "@/lib/reconciliation";
import {
  applyCanonicalImportContext,
  parseCanonicalImportContext,
} from "@/lib/reconciliation/import-context";
import {
  buildDurableImport,
  reconciliationRunKey,
} from "@/lib/reconciliation/persistence";
import {
  RECONCILIATION_ENGINE_VERSION,
  type StoredWorkspaceData,
  type WorkspaceDataPersistence,
} from "@/lib/reconciliation/workspace-data";
import { parseWorkspaceReconciliationDefaults } from "@/lib/reconciliation/workspace-defaults";
import { loadWorkspaceMatchingRuleCatalog, workspaceRuleRuntime } from "@/lib/reconciliation/workspace-rules";
import type { ReconciliationContext } from "@/lib/reconciliation";
import {
  parseReconciliationEntitlement,
  paymentLimitResponse,
  type PaymentLimitExceeded,
} from "@/lib/billing/entitlements";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_LOCAL_RESPONSE_SIZE = 4 * 1024 * 1024;
const workspaceIdSchema = z.string().uuid();

type PersistenceOutcome =
  | {
      kind: "ready";
      value: WorkspaceDataPersistence;
      canonicalCounts?: {
        newPayments: number;
        existingPayments: number;
        carriedPayments: number;
        resolvedPayments: number;
        existingInvoices: number;
      };
    }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "limit_exceeded"; entitlement: PaymentLimitExceeded };

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;
type LiveWorkspaceAccess =
  | {
      kind: "ready";
      supabase: ServerSupabaseClient;
      organizationId: string;
      userId: string;
      currencyCode: string;
      matchDaysBefore: number;
      matchDaysAfter: number;
      ruleContext: ReconciliationContext;
      payerMappingFingerprint: string;
      matchingRuleFingerprint?: string;
    }
  | { kind: "not_configured" | "not_authenticated" | "forbidden" | "unavailable" };

function localPersistence(reason: WorkspaceDataPersistence["reason"]): PersistenceOutcome {
  return { kind: "ready", value: { status: "local", reason } };
}

function persistenceRpcResult(value: unknown): {
  runRecordId: string;
  savedAt: string;
  canonicalCounts?: {
    newPayments: number;
    existingPayments: number;
    carriedPayments: number;
    resolvedPayments: number;
    existingInvoices: number;
  };
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.run_record_id !== "string" || typeof record.saved_at !== "string") return null;
  const rawCounts = [
    record.new_payment_count,
    record.duplicate_payment_count,
    record.carried_payment_count,
    record.resolved_payment_count,
    record.duplicate_invoice_count,
  ];
  const canonicalCounts = rawCounts.every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0)
    ? {
        newPayments: rawCounts[0] as number,
        existingPayments: rawCounts[1] as number,
        carriedPayments: rawCounts[2] as number,
        resolvedPayments: rawCounts[3] as number,
        existingInvoices: rawCounts[4] as number,
      }
    : undefined;
  return { runRecordId: record.run_record_id, savedAt: record.saved_at, canonicalCounts };
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value
    && typeof value === "object"
    && "name" in value
    && typeof value.name === "string"
    && "size" in value
    && typeof value.size === "number"
    && "arrayBuffer" in value
    && typeof value.arrayBuffer === "function",
  );
}

async function persistRun(input: {
  workspaceId: string;
  snapshot: StoredWorkspaceData;
  billablePaymentCount: number;
  invoiceImport: ReturnType<typeof buildDurableImport>;
  paymentImport: ReturnType<typeof buildDurableImport>;
}, supabase: ServerSupabaseClient | null): Promise<PersistenceOutcome> {
  if (input.workspaceId === "demo") return localPersistence("demo");
  if (!workspaceIdSchema.safeParse(input.workspaceId).success) return { kind: "forbidden" };
  if (!supabase) return { kind: "unavailable" };

  const { data: entitlementData, error: entitlementError } = await supabase.rpc(
    "reserve_reconciliation_capacity",
    {
      p_workspace_id: input.workspaceId,
      p_run_key: input.snapshot.runId,
      p_engine_version: RECONCILIATION_ENGINE_VERSION,
      p_payment_count: input.billablePaymentCount,
    },
  );
  if (entitlementError) {
    if (entitlementError.code === "42501") return { kind: "forbidden" };
    logServerError(entitlementError, {
      operation: "reserve_reconciliation_capacity",
      code: entitlementError.code,
    });
    return { kind: "unavailable" };
  }
  const entitlement = parseReconciliationEntitlement(entitlementData);
  if (!entitlement) {
    logServerError(new Error("Capacity RPC returned an invalid result"), {
      operation: "reserve_reconciliation_capacity",
    });
    return { kind: "unavailable" };
  }
  if (!entitlement.allowed) return { kind: "limit_exceeded", entitlement };

  const { data, error } = await supabase.rpc("persist_reconciliation_run_v2", {
    p_workspace_id: input.workspaceId,
    p_run_key: input.snapshot.runId,
    p_engine_version: RECONCILIATION_ENGINE_VERSION,
    p_snapshot: input.snapshot,
    p_invoice_import: input.invoiceImport,
    p_payment_import: input.paymentImport,
  });
  if (error) {
    if (error.code === "42501") return { kind: "forbidden" };
    logServerError(error, { operation: "persist_reconciliation_run_v2", code: error.code });
    return { kind: "unavailable" };
  }

  const persisted = persistenceRpcResult(data);
  if (!persisted) {
    logServerError(new Error("Persistence RPC returned an invalid result"), { operation: "persist_reconciliation_run_v2" });
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    value: {
      status: "durable",
      runRecordId: persisted.runRecordId,
      savedAt: persisted.savedAt,
    },
    canonicalCounts: persisted.canonicalCounts,
  };
}

async function authorizeLiveWorkspace(workspaceId: string): Promise<LiveWorkspaceAccess> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { kind: "not_configured" };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    logServerError(authError, { operation: "reconciliation_persistence_auth" });
    return { kind: "unavailable" };
  }
  if (!authData.user) return { kind: "not_authenticated" };
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,organization_id,currency_code,match_days_before,match_days_after")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) {
    logServerError(workspaceError, { operation: "reconciliation_persistence_scope", code: workspaceError.code });
    return { kind: "unavailable" };
  }
  if (!workspace) return { kind: "forbidden" };
  const defaults = parseWorkspaceReconciliationDefaults(workspace);
  if (!defaults) {
    logServerError(new Error("Workspace matching defaults are invalid"), {
      operation: "reconciliation_workspace_defaults",
    });
    return { kind: "unavailable" };
  }
  const rules = await loadWorkspaceMatchingRuleCatalog(supabase, workspaceId, String(workspace.organization_id));
  if (rules.status === "unavailable") return { kind: "unavailable" };
  const ruleRuntime = workspaceRuleRuntime(rules.catalog);
  return {
    kind: "ready",
    supabase,
    organizationId: String(workspace.organization_id),
    userId: authData.user.id,
    currencyCode: defaults.currencyCode,
    matchDaysBefore: defaults.config.earlyPaymentAllowanceDays,
    matchDaysAfter: defaults.config.dateWindowDays,
    ruleContext: ruleRuntime.context,
    payerMappingFingerprint: ruleRuntime.payerMappingFingerprint,
    matchingRuleFingerprint: ruleRuntime.matchingRuleFingerprint,
  };
}

async function recordLiveImportError(
  access: Extract<LiveWorkspaceAccess, { kind: "ready" }> | null,
  workspaceId: string,
  errorCode: string,
  safeMessage: string,
) {
  if (!access) return;
  const { error } = await access.supabase.from("application_errors").insert({
    organization_id: access.organizationId,
    workspace_id: workspaceId,
    user_id: access.userId,
    error_code: errorCode.slice(0, 100),
    severity: "error",
    component: "reconciliation_import",
    safe_message: safeMessage.slice(0, 500),
    fingerprint: `reconciliation_import:${errorCode}`.slice(0, 200),
    context: { stage: "import_and_match" },
  });
  if (error) logServerError(error, { operation: "record_import_error", code: error.code });
}

function liveAccessError(access: Exclude<LiveWorkspaceAccess, { kind: "ready" }>) {
  if (access.kind === "not_authenticated") return NextResponse.json({ error: "Sign in before processing files for this workspace." }, { status: 401 });
  if (access.kind === "forbidden") return NextResponse.json({ error: "You do not have permission to process reconciliation runs in this workspace." }, { status: 403 });
  if (access.kind === "not_configured") return NextResponse.json({ error: "Saved workspace processing is not configured. No files were processed." }, { status: 503 });
  return NextResponse.json({ error: "Saved workspace processing is temporarily unavailable. No files were processed." }, { status: 503 });
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "reconciliation-run"), prefix: "reconciliation-run", limit: 12, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Reconciliation processing is temporarily unavailable." : "Too many reconciliation attempts. Wait a few minutes and try again." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_SIZE * 2 + 100_000) return NextResponse.json({ error: "The combined import is larger than the 4 MB processing limit." }, { status: 413 });
  const requestedWorkspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim() || null;
  if (requestedWorkspaceId && requestedWorkspaceId !== "demo" && !workspaceIdSchema.safeParse(requestedWorkspaceId).success) return NextResponse.json({ error: "Choose a valid workspace before running reconciliation." }, { status: 400 });
  let liveAccess: Extract<LiveWorkspaceAccess, { kind: "ready" }> | null = null;
  if (requestedWorkspaceId && requestedWorkspaceId !== "demo") {
    const access = await authorizeLiveWorkspace(requestedWorkspaceId);
    if (access.kind !== "ready") return liveAccessError(access);
    liveAccess = access;
  }
  const form = await request.formData();
  const invoiceFile = form.get("invoiceFile");
  const paymentFile = form.get("paymentFile");
  const workspaceId = form.get("workspaceId")?.toString().trim() || requestedWorkspaceId || "demo";
  if (!isUploadedFile(invoiceFile) || !isUploadedFile(paymentFile)) return NextResponse.json({ error: "Choose both an invoice file and a payment file." }, { status: 400 });
  if (workspaceId !== "demo" && !workspaceIdSchema.safeParse(workspaceId).success) return NextResponse.json({ error: "Choose a valid workspace before running reconciliation." }, { status: 400 });
  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) return NextResponse.json({ error: "The requested workspace does not match the uploaded reconciliation." }, { status: 400 });
  if (workspaceId !== "demo" && !liveAccess) {
    const access = await authorizeLiveWorkspace(workspaceId);
    if (access.kind !== "ready") return liveAccessError(access);
    liveAccess = access;
  }

  try {
    const [invoiceSource, paymentSource] = await Promise.all([
      readUploadedImportFile(invoiceFile, form.get("invoiceSheet")?.toString(), MAX_FILE_SIZE),
      readUploadedImportFile(paymentFile, form.get("paymentSheet")?.toString(), MAX_FILE_SIZE),
    ]);
    const invoiceMapping = requestedColumnMapping(form.get("invoiceMapping"), invoiceSource.headers, "invoice");
    const paymentMapping = requestedColumnMapping(form.get("paymentMapping"), paymentSource.headers, "payment");
    const defaultCurrency = liveAccess?.currencyCode || "USD";
    const reconciliationContext = {
      defaultCurrency,
      earlyPaymentAllowanceDays: liveAccess?.matchDaysBefore ?? 3,
      dateWindowDays: liveAccess?.matchDaysAfter ?? 90,
      payerMappingFingerprint: liveAccess?.payerMappingFingerprint,
      matchingRuleFingerprint: liveAccess?.matchingRuleFingerprint,
    };
    const runId = reconciliationRunKey(
      invoiceSource.sha256,
      paymentSource.sha256,
      invoiceMapping,
      paymentMapping,
      fingerprintImport,
      reconciliationContext,
    );
    const invoiceResult = normalizeInvoiceRows(invoiceSource.rows, invoiceMapping, { sourceImportId: `invoice-${invoiceSource.fingerprint}`, idPrefix: "invoice", defaultCurrency });
    const paymentResult = normalizePaymentRows(paymentSource.rows, paymentMapping, { sourceImportId: `payment-${paymentSource.fingerprint}`, idPrefix: "payment", defaultCurrency });
    const normalizedInvoices = invoiceResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    const normalizedPayments = paymentResult.accepted.flatMap((row) => row.value ? [row.value] : []);
    if (normalizedInvoices.length === 0) {
      await recordLiveImportError(liveAccess, workspaceId, "no_valid_invoice_rows", "No valid invoice rows remained after column mapping and normalization.");
      return NextResponse.json({ error: "No valid invoices could be imported. Check the invoice number, customer, date, and amount mappings.", issues: invoiceResult.issues.slice(0, 30) }, { status: 422 });
    }
    if (normalizedPayments.length === 0) {
      await recordLiveImportError(liveAccess, workspaceId, "no_valid_payment_rows", "No valid payment rows remained after column mapping and normalization.");
      return NextResponse.json({ error: "No valid payments could be imported. Check the payment date and amount mappings.", issues: paymentResult.issues.slice(0, 30) }, { status: 422 });
    }
    let invoices = normalizedInvoices;
    let payments = normalizedPayments;
    let previouslyImportedInvoiceCount = 0;
    let previouslyImportedPaymentCount = 0;
    let carriedPaymentCount = 0;
    let excludedPaymentCount = 0;
    let billablePaymentCount = normalizedPayments.length;
    if (liveAccess) {
      const { data: contextData, error: contextError } = await liveAccess.supabase.rpc(
        "get_reconciliation_import_context",
        {
          p_workspace_id: workspaceId,
          p_invoices: normalizedInvoices,
          p_payments: normalizedPayments,
        },
      );
      if (contextError) {
        logServerError(contextError, { operation: "get_reconciliation_import_context", code: contextError.code });
        return NextResponse.json({ error: "Existing reconciliation records could not be checked safely. No files were processed." }, { status: contextError.code === "42501" ? 403 : 503, headers: rateLimitHeaders(limit) });
      }
      const context = parseCanonicalImportContext(contextData);
      const canonicalized = context ? applyCanonicalImportContext(normalizedInvoices, normalizedPayments, context) : null;
      if (!canonicalized) {
        logServerError(new Error("Canonical import context returned an invalid result"), { operation: "get_reconciliation_import_context" });
        return NextResponse.json({ error: "Existing reconciliation records could not be checked safely. No files were processed." }, { status: 503, headers: rateLimitHeaders(limit) });
      }
      invoices = canonicalized.invoices;
      payments = canonicalized.payments;
      previouslyImportedInvoiceCount = canonicalized.existingInvoiceIds.length;
      previouslyImportedPaymentCount = canonicalized.existingPaymentIds.length;
      carriedPaymentCount = canonicalized.carriedPaymentIds.length;
      excludedPaymentCount = canonicalized.excludedPaymentIds.length;
      billablePaymentCount = canonicalized.newPaymentCount;
    }
    const result = reconcile(invoices, payments, liveAccess ? {
      earlyPaymentAllowanceDays: liveAccess.matchDaysBefore,
      dateWindowDays: liveAccess.matchDaysAfter,
    } : undefined, liveAccess?.ruleContext);
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
        invoicesPreviouslyImported: previouslyImportedInvoiceCount,
        invoicesRejected: invoiceResult.rejected.length,
        paymentRows: paymentSource.rows.length,
        paymentsAccepted: normalizedPayments.length,
        paymentsActiveInRun: payments.length,
        paymentsNew: billablePaymentCount,
        paymentsPreviouslyImported: previouslyImportedPaymentCount,
        paymentsCarriedForward: carriedPaymentCount,
        paymentsAlreadyResolved: excludedPaymentCount,
        paymentsRejected: paymentResult.rejected.length,
      },
      sourceFiles: {
        invoice: {
          name: invoiceFile.name,
          rows: invoiceSource.rows.length,
          accepted: invoices.length,
          rejected: invoiceResult.rejected.length,
        },
        payment: {
          name: paymentFile.name,
          rows: paymentSource.rows.length,
          accepted: normalizedPayments.length,
          rejected: paymentResult.rejected.length,
        },
      },
      reconciliationContext,
    };
    const persistence = await persistRun({
      workspaceId,
      snapshot,
      billablePaymentCount,
      invoiceImport: buildDurableImport({
        fileName: invoiceFile.name,
        fileSize: invoiceFile.size,
        sha256: invoiceSource.sha256,
          sheetName: invoiceSource.selectedSheet,
        headers: invoiceSource.headers,
        rows: invoiceSource.rows,
        mapping: invoiceMapping,
        normalization: invoiceResult,
      }),
      paymentImport: buildDurableImport({
        fileName: paymentFile.name,
        fileSize: paymentFile.size,
        sha256: paymentSource.sha256,
          sheetName: paymentSource.selectedSheet,
        headers: paymentSource.headers,
        rows: paymentSource.rows,
        mapping: paymentMapping,
        normalization: paymentResult,
      }),
    }, liveAccess?.supabase || null);
    if (persistence.kind === "forbidden") return NextResponse.json({ error: "You do not have permission to save reconciliation runs in this workspace." }, { status: 403, headers: rateLimitHeaders(limit) });
    if (persistence.kind === "unavailable") {
      await recordLiveImportError(liveAccess, workspaceId, "durable_save_unavailable", "A reconciliation run could not be securely saved.");
      return NextResponse.json({ error: "The reconciliation could not be securely authorized and saved, so no workspace run was created. Retry when durable storage is available." }, { status: 503, headers: rateLimitHeaders(limit) });
    }
    if (persistence.kind === "limit_exceeded") return NextResponse.json(paymentLimitResponse(persistence.entitlement), { status: 402, headers: rateLimitHeaders(limit) });
    const issueCount = invoiceSource.parseIssues.length + paymentSource.parseIssues.length + invoiceResult.issues.length + paymentResult.issues.length;
    if (persistence.value.status === "durable") {
      const canonicalCounts = persistence.canonicalCounts;
      const durableImportSummary = canonicalCounts ? {
        ...snapshot.importSummary,
        invoicesPreviouslyImported: canonicalCounts.existingInvoices,
        paymentsNew: canonicalCounts.newPayments,
        paymentsPreviouslyImported: canonicalCounts.existingPayments,
        paymentsCarriedForward: canonicalCounts.carriedPayments,
        paymentsAlreadyResolved: canonicalCounts.resolvedPayments,
      } : snapshot.importSummary;
      return NextResponse.json({
        runId: snapshot.runId,
        completedAt: snapshot.completedAt,
        persistence: persistence.value,
        importSummary: durableImportSummary,
        sourceFiles: snapshot.sourceFiles,
        counts: {
          invoices: invoices.length,
          payments: payments.length,
          matches: result.matches.length,
          review: result.matches.filter((match) => match.confidence === "review" || match.confidence === "unmatched").length,
          issues: issueCount,
        },
      }, { headers: rateLimitHeaders(limit) });
    }

    const localBody = JSON.stringify({
      ...snapshot,
      persistence: persistence.value,
      issues: [...invoiceSource.parseIssues, ...paymentSource.parseIssues, ...invoiceResult.issues, ...paymentResult.issues].slice(0, 100),
    });
    if (new TextEncoder().encode(localBody).byteLength > MAX_LOCAL_RESPONSE_SIZE) {
      return NextResponse.json({ error: "This browser-local result is too large to return safely. Use smaller demo files." }, { status: 413, headers: rateLimitHeaders(limit) });
    }
    return new NextResponse(localBody, {
      headers: { "Content-Type": "application/json; charset=utf-8", ...rateLimitHeaders(limit) },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    logServerError(error, { operation: "reconciliation_run", code });
    const message = code === "large" ? "Each file must be 2 MB or smaller." : code === "empty" ? "One of the selected files is empty." : code === "sheet" ? "Choose a worksheet that contains invoice or payment rows." : code.startsWith("unsafe_csv") ? uploadSafetyMessage(code, "csv") : code.startsWith("unsafe_xlsx") ? uploadSafetyMessage(code, "xlsx") : code.startsWith("unsafe_table") ? "The file contains too many columns or a header or cell exceeds the safe text limits." : "We could not process one of the files. Use a valid, unencrypted CSV or XLSX file.";
    await recordLiveImportError(liveAccess, workspaceId, code.startsWith("unsafe_") ? code : "import_processing_failed", message);
    return NextResponse.json({ error: message }, { status: code === "large" ? 413 : 422 });
  }
}
