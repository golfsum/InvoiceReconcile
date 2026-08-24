import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { asyncSourceIdSchema } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { importSourcePreviewWorkflow } from "@/workflows/import-source";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsedId = asyncSourceIdSchema.safeParse((await context.params).sourceId);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid import source." }, { status: 400 });
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "import-source-finalize"),
    prefix: "import-source-finalize",
    limit: 30,
    windowSeconds: 300,
  });
  if (!limit.allowed) return NextResponse.json({
    error: limit.source === "unavailable" ? "Secure import finalization is temporarily unavailable." : "Too many import requests. Wait a few minutes and try again.",
  }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  if (!supabase || !service) return NextResponse.json({ error: "Private background imports are not configured." }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Import authorization is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) });
  if (!authData.user) return NextResponse.json({ error: "Sign in before finalizing workspace files." }, { status: 401, headers: rateLimitHeaders(limit) });

  const { data, error } = await supabase.rpc("finalize_async_import_source", { p_source_id: parsedId.data });
  if (error) {
    logServerError(error, { operation: "finalize_async_import_source", code: error.code });
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
    return NextResponse.json({ error: status === 403
      ? "You do not have permission to finalize this upload."
      : status === 400
        ? "The uploaded object does not match its authorization. Start a new upload."
        : "The upload could not be finalized safely." }, { status, headers: rateLimitHeaders(limit) });
  }
  const result = record(data);
  if (!result || typeof result.source_id !== "string" || typeof result.status !== "string") {
    return NextResponse.json({ error: "The upload could not be finalized safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  if (result.status === "expired") return NextResponse.json({ error: "The upload window expired. Start a new upload." }, { status: 410, headers: rateLimitHeaders(limit) });
  if (result.status === "preview_queued") {
    try {
      const run = await start(importSourcePreviewWorkflow, [result.source_id]);
      const { error: attachError } = await service.rpc("attach_async_import_workflow", {
        p_source_id: result.source_id,
        p_workflow_run_id: run.runId,
      });
      if (attachError) logServerError(attachError, { operation: "attach_async_import_workflow", code: attachError.code });
    } catch (workflowError) {
      logServerError(workflowError, { operation: "start_async_import_preview" });
      return NextResponse.json({ error: "The upload is safe, but background preview could not start yet. Retry finalization." }, { status: 503, headers: rateLimitHeaders(limit) });
    }
  }
  return NextResponse.json({ sourceId: result.source_id, status: result.status }, {
    status: result.status === "preview_ready" ? 200 : 202,
    headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
  });
}
