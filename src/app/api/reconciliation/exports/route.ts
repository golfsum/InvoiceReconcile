import { NextResponse } from "next/server";
import { z } from "zod";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const exportSchema = z.object({
  workspaceId: z.string().uuid(),
  runRecordId: z.string().uuid(),
  exportType: z.enum(["reconciled", "unmatched", "discrepancy", "audit"]),
  fileType: z.enum(["csv", "xlsx"]),
  rowCount: z.number().int().nonnegative().max(100_000),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "reconciliation-export"),
    prefix: "reconciliation-export",
    limit: 60,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.source === "unavailable" ? "Export auditing is temporarily unavailable." : "Too many export attempts. Wait a moment and try again." },
      { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid reconciliation export request." }, { status: 400 });
  }
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "The reconciliation export is invalid." }, { status: 400 });

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Export auditing is not configured. No file was downloaded." }, { status: 503 });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Sign in to download and record this export." }, { status: 401 });

  const value = parsed.data;
  const { data, error } = await supabase.rpc("record_reconciliation_export", {
    p_workspace_id: value.workspaceId,
    p_run_record_id: value.runRecordId,
    p_export_type: value.exportType,
    p_file_type: value.fileType,
    p_row_count: value.rowCount,
    p_idempotency_key: value.idempotencyKey,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "You do not have permission to export this reconciliation run." }, { status: 403 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
    logServerError(error, { operation: "record_reconciliation_export", code: error.code });
    return NextResponse.json({ error: "The export could not be recorded, so no file was downloaded." }, { status: 503 });
  }
  if (!data || typeof data !== "object" || !("event_id" in data)) {
    logServerError(new Error("Export RPC returned an invalid result"), { operation: "record_reconciliation_export" });
    return NextResponse.json({ error: "The export audit record could not be confirmed, so no file was downloaded." }, { status: 503 });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
