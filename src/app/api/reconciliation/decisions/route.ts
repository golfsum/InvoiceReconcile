import { NextResponse } from "next/server";
import { z } from "zod";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const allocationSchema = z.object({
  invoiceId: z.string().trim().min(1).max(1000),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const decisionSchema = z.object({
  workspaceId: z.string().uuid(),
  runRecordId: z.string().uuid(),
  matchId: z.string().trim().min(1).max(1000),
  outcome: z.enum(["confirmed", "rejected", "unmatched"]),
  allocations: z.array(allocationSchema).max(100).default([]),
  appliedAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  note: z.string().trim().max(2000).optional(),
  feeMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  feedback: z.enum(["correct", "incorrect"]).optional(),
  idempotencyKey: z.string().uuid(),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  let allocationTotal = 0;
  for (const [index, allocation] of value.allocations.entries()) {
    if (seen.has(allocation.invoiceId)) {
      context.addIssue({ code: "custom", path: ["allocations", index, "invoiceId"], message: "Each invoice can appear only once." });
    }
    seen.add(allocation.invoiceId);
    if (allocationTotal > Number.MAX_SAFE_INTEGER - allocation.amountMinor) {
      context.addIssue({ code: "custom", path: ["allocations"], message: "The allocation total is too large." });
      return;
    }
    allocationTotal += allocation.amountMinor;
  }
  if (value.outcome === "confirmed" && value.allocations.length === 0) {
    context.addIssue({ code: "custom", path: ["allocations"], message: "Choose at least one invoice allocation." });
  }
  if (value.outcome === "confirmed" && allocationTotal !== value.appliedAmountMinor) {
    context.addIssue({ code: "custom", path: ["appliedAmountMinor"], message: "The applied total must equal the sum of the invoice allocations." });
  }
  if (value.outcome !== "confirmed" && (value.allocations.length > 0 || value.appliedAmountMinor !== 0)) {
    context.addIssue({ code: "custom", path: ["allocations"], message: "Only a confirmed decision can include invoice allocations." });
  }
});

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "reconciliation-decision"),
    prefix: "reconciliation-decision",
    limit: 120,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: limit.source === "unavailable" ? "Decision storage is temporarily unavailable." : "Too many decision attempts. Wait a moment and try again." },
      { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid reconciliation decision." }, { status: 400 });
  }
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "The reconciliation decision is invalid." }, { status: 400 });

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Durable decision storage is not configured." }, { status: 503 });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Sign in to save this decision." }, { status: 401 });

  const decision = parsed.data;
  const { data, error } = await supabase.rpc("record_reconciliation_decision_v2", {
    p_workspace_id: decision.workspaceId,
    p_run_record_id: decision.runRecordId,
    p_client_match_id: decision.matchId,
    p_outcome: decision.outcome,
    p_invoice_allocations: decision.outcome === "confirmed" ? decision.allocations : [],
    p_applied_amount_minor: decision.outcome === "confirmed" ? decision.appliedAmountMinor : 0,
    p_note: decision.note || null,
    p_fee_minor: decision.feeMinor || 0,
    p_feedback: decision.feedback || null,
    p_idempotency_key: decision.idempotencyKey,
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "You do not have permission to decide matches in this workspace." }, { status: 403 });
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 });
    if (error.code === "55000") return NextResponse.json({ error: error.message }, { status: 409 });
    logServerError(error, { operation: "record_reconciliation_decision", code: error.code });
    return NextResponse.json({ error: "The decision could not be saved. No reconciliation balances were changed." }, { status: 503 });
  }
  if (!data || typeof data !== "object" || !("decision" in data)) {
    logServerError(new Error("Decision RPC returned an invalid result"), { operation: "record_reconciliation_decision" });
    return NextResponse.json({ error: "The saved decision could not be confirmed." }, { status: 503 });
  }
  return NextResponse.json(data, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}
