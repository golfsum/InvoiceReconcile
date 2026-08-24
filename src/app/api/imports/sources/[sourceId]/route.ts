import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { asyncSourceIdSchema } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { importSourceDeletionWorkflow } from "@/workflows/import-source";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  const parsedId = asyncSourceIdSchema.safeParse((await context.params).sourceId);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid import source." }, { status: 400 });
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Saved import status is not configured." }, { status: 503 });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    logServerError(authError, { operation: "async_import_source_status_auth", code: authError.code });
    return NextResponse.json({ error: "Import status is temporarily unavailable." }, { status: 503 });
  }
  if (!authData.user) return NextResponse.json({ error: "Sign in to view this import." }, { status: 401 });
  const { data, error } = await supabase
    .from("import_source_uploads")
    .select("id,import_kind,source_type,expected_byte_size,status,selected_sheet,sheet_names,source_headers,row_count,suggested_mapping,mapping_source,issue_summary,progress_current,progress_total,progress_label,error_code,error_message,object_deletion_status,object_deletion_requested_at,object_deleted_at,created_at,updated_at")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (error) {
    logServerError(error, { operation: "async_import_source_status", code: error.code });
    return NextResponse.json({ error: "Import status is temporarily unavailable." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "This import source was not found." }, { status: 404 });
  return NextResponse.json({
    sourceId: data.id,
    kind: data.import_kind,
    sourceType: data.source_type,
    byteSize: data.expected_byte_size,
    status: data.status,
    selectedSheet: data.selected_sheet,
    sheets: data.sheet_names,
    headers: data.source_headers,
    rowCount: data.row_count,
    mapping: data.suggested_mapping,
    mappingSource: data.mapping_source,
    issues: data.issue_summary,
    progress: {
      current: data.progress_current,
      total: data.progress_total,
      label: data.progress_label,
    },
    error: data.error_code ? { code: data.error_code, message: data.error_message } : null,
    deletion: {
      status: data.object_deletion_status,
      requestedAt: data.object_deletion_requested_at,
      deletedAt: data.object_deleted_at,
    },
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsedId = asyncSourceIdSchema.safeParse((await context.params).sourceId);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid import source." }, { status: 400 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "import-source-delete"), prefix: "import-source-delete", limit: 20, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Source deletion is temporarily unavailable." : "Too many deletion requests. Wait a few minutes and try again." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Private source deletion is not configured." }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Source deletion authorization is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) });
  if (!authData.user) return NextResponse.json({ error: "Sign in before deleting a private source." }, { status: 401, headers: rateLimitHeaders(limit) });
  const { data, error } = await supabase.rpc("request_async_import_source_deletion", { p_source_id: parsedId.data });
  if (error) {
    logServerError(error, { operation: "request_async_import_source_deletion", code: error.code });
    return NextResponse.json({ error: error.code === "42501" ? "You do not have permission to delete this source." : "Source deletion could not be scheduled safely." }, { status: error.code === "42501" ? 403 : 503, headers: rateLimitHeaders(limit) });
  }
  const result = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (!result || typeof result.source_id !== "string" || typeof result.deletion_status !== "string") {
    return NextResponse.json({ error: "Source deletion could not be scheduled safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  if (result.deletion_status !== "deleted") {
    try {
      await start(importSourceDeletionWorkflow, [result.source_id]);
    } catch (workflowError) {
      logServerError(workflowError, { operation: "start_import_source_deletion" });
      return NextResponse.json({
        error: "Deletion is pending, but its immediate retry workflow could not start. Retry this action.",
        sourceId: result.source_id,
        deletionStatus: "pending",
      }, { status: 503, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } });
    }
  }
  return NextResponse.json({
    sourceId: result.source_id,
    deletionStatus: result.deletion_status,
    message: result.deletion_status === "deleted"
      ? "The private source was already deleted."
      : "Private source deletion is pending and will be retried until confirmed.",
  }, { status: result.deletion_status === "deleted" ? 200 : 202, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } });
}
