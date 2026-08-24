import { NextResponse } from "next/server";
import { asyncSourceIdSchema } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  const parsedId = asyncSourceIdSchema.safeParse((await context.params).requestId);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid reconciliation request." }, { status: 400 });
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Saved reconciliation status is not configured." }, { status: 503 });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) return NextResponse.json({ error: "Reconciliation status is temporarily unavailable." }, { status: 503 });
  if (!authData.user) return NextResponse.json({ error: "Sign in to view this reconciliation." }, { status: 401 });
  const { data, error } = await supabase
    .from("async_reconciliation_requests")
    .select("id,status,progress_current,progress_total,progress_label,run_record_id,result_summary,error_code,error_message,created_at,started_at,completed_at,updated_at")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (error) {
    logServerError(error, { operation: "async_reconciliation_status", code: error.code });
    return NextResponse.json({ error: "Reconciliation status is temporarily unavailable." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "This reconciliation request was not found." }, { status: 404 });
  return NextResponse.json({
    requestId: data.id,
    status: data.status,
    progress: { current: data.progress_current, total: data.progress_total, label: data.progress_label },
    runRecordId: data.run_record_id,
    counts: data.result_summary,
    error: data.error_code ? { code: data.error_code, message: data.error_message } : null,
    createdAt: data.created_at,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    updatedAt: data.updated_at,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
