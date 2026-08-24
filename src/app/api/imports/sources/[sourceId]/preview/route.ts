import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { asyncSourceIdSchema, requeueAsyncPreviewSchema } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { importSourcePreviewWorkflow } from "@/workflows/import-source";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsedId = asyncSourceIdSchema.safeParse((await context.params).sourceId);
  const parsedBody = requeueAsyncPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) return NextResponse.json({ error: "Choose a worksheet discovered in this source." }, { status: 400 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "import-source-sheet"), prefix: "import-source-sheet", limit: 20, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Worksheet processing is temporarily unavailable." : "Too many worksheet changes. Wait a few minutes and try again." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  if (!supabase || !service) return NextResponse.json({ error: "Private background imports are not configured." }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Import authorization is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) });
  if (!authData.user) return NextResponse.json({ error: "Sign in before changing this worksheet." }, { status: 401, headers: rateLimitHeaders(limit) });
  const { data, error } = await supabase.rpc("requeue_async_import_preview", {
    p_source_id: parsedId.data,
    p_sheet_name: parsedBody.data.sheet,
  });
  if (error) {
    logServerError(error, { operation: "requeue_async_import_preview", code: error.code });
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
    return NextResponse.json({ error: status === 403 ? "You do not have permission to change this import." : status === 400 ? "Choose a worksheet discovered in this source." : "The worksheet could not be queued safely." }, { status, headers: rateLimitHeaders(limit) });
  }
  const result = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (!result || typeof result.source_id !== "string") return NextResponse.json({ error: "The worksheet could not be queued safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  try {
    const run = await start(importSourcePreviewWorkflow, [result.source_id]);
    await service.rpc("attach_async_import_workflow", { p_source_id: result.source_id, p_workflow_run_id: run.runId });
  } catch (workflowError) {
    logServerError(workflowError, { operation: "restart_async_import_preview" });
    return NextResponse.json({ error: "The worksheet is queued, but background preview could not start yet. Retry this selection." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  return NextResponse.json({ sourceId: result.source_id, status: "preview_queued" }, { status: 202, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } });
}
