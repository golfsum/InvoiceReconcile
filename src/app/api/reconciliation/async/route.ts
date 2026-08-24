import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { enqueueAsyncReconciliationSchema } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { asyncReconciliationWorkflow } from "@/workflows/reconciliation";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 150_000) {
    return NextResponse.json({ error: "The reconciliation request is too large." }, { status: 413 });
  }
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "async-reconciliation"),
    prefix: "async-reconciliation",
    limit: 12,
    windowSeconds: 300,
  });
  if (!limit.allowed) return NextResponse.json({
    error: limit.source === "unavailable" ? "Background reconciliation is temporarily unavailable." : "Too many reconciliation attempts. Wait a few minutes and try again.",
  }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const parsed = enqueueAsyncReconciliationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confirm both validated imports and their required mappings." }, { status: 400, headers: rateLimitHeaders(limit) });
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  if (!supabase || !service) return NextResponse.json({ error: "Durable background reconciliation is not configured." }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Reconciliation authorization is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) });
  if (!authData.user) return NextResponse.json({ error: "Sign in before running a workspace reconciliation." }, { status: 401, headers: rateLimitHeaders(limit) });
  const { data, error } = await supabase.rpc("enqueue_async_reconciliation", {
    p_workspace_id: parsed.data.workspaceId,
    p_invoice_source_id: parsed.data.invoiceSourceId,
    p_payment_source_id: parsed.data.paymentSourceId,
    p_invoice_mapping: parsed.data.invoiceMapping,
    p_payment_mapping: parsed.data.paymentMapping,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    logServerError(error, { operation: "enqueue_async_reconciliation", code: error.code });
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
    return NextResponse.json({ error: status === 403
      ? "You do not have permission to process these sources."
      : status === 400
        ? "The source mappings are incomplete or no longer valid."
        : "The reconciliation could not be queued safely." }, { status, headers: rateLimitHeaders(limit) });
  }
  const result = record(data);
  if (!result || typeof result.allowed !== "boolean") return NextResponse.json({ error: "The reconciliation could not be queued safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  if (!result.allowed) return NextResponse.json({
    error: "This source exceeds the current plan's payment processing allowance.",
    code: "payment_limit_exceeded",
    upgradeRequired: true,
    upgradeUrl: "/settings/billing",
    entitlement: {
      plan: result.plan,
      limit: result.limit,
      requested: result.requested,
    },
  }, { status: 402, headers: rateLimitHeaders(limit) });
  if (typeof result.request_id !== "string" || typeof result.status !== "string") {
    return NextResponse.json({ error: "The reconciliation could not be queued safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  if (result.status !== "succeeded") {
    try {
      const run = await start(asyncReconciliationWorkflow, [result.request_id]);
      const { error: attachError } = await service.rpc("attach_async_reconciliation_workflow", {
        p_request_id: result.request_id,
        p_workflow_run_id: run.runId,
      });
      if (attachError) logServerError(attachError, { operation: "attach_async_reconciliation_workflow", code: attachError.code });
    } catch (workflowError) {
      logServerError(workflowError, { operation: "start_async_reconciliation" });
      return NextResponse.json({
        error: "The request is safely queued, but its background run could not start yet. Retry with the same imports.",
        requestId: result.request_id,
      }, { status: 503, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } });
    }
  }
  return NextResponse.json({ requestId: result.request_id, status: result.status }, {
    status: result.status === "succeeded" ? 200 : 202,
    headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
  });
}
