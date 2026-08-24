import { NextResponse } from "next/server";
import { z } from "zod";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalDescriptionPattern, canonicalReferenceTemplate } from "@/lib/reconciliation/custom-rules";

export const runtime = "nodejs";

const paramsSchema = z.object({ workspaceId: z.string().uuid() }).strict();
const payerCreateSchema = z.object({
  type: z.literal("payer_alias").optional(),
  alias: z.string().trim().min(2, "Enter a payer name with at least 2 characters.").max(200),
  customerId: z.string().uuid("Choose a customer from this workspace."),
}).strict();
const descriptionCreateSchema = z.object({
  type: z.literal("description_customer"),
  pattern: z.string().trim().min(4).max(120).refine((value) => Boolean(canonicalDescriptionPattern(value)), "Enter at least four usable description characters."),
  customerId: z.string().uuid("Choose a customer from this workspace."),
}).strict();
const referenceCreateSchema = z.object({
  type: z.literal("reference_template"),
  pattern: z.string().trim().min(4).max(80).refine((value) => Boolean(canonicalReferenceTemplate(value)), "Use one {digits} or {alnum} token with at least two literal characters."),
}).strict();
const feeCreateSchema = z.object({
  type: z.literal("accepted_fee_behavior"),
  pattern: z.string().trim().min(4).max(120).refine((value) => Boolean(canonicalDescriptionPattern(value)), "Enter at least four usable descriptor characters."),
  maximumFeeMinor: z.number().int().min(1).max(25_000),
  maximumFeeBasisPoints: z.number().int().min(1).max(500),
}).strict();
const createSchema = z.union([payerCreateSchema, descriptionCreateSchema, referenceCreateSchema, feeCreateSchema]);
const deleteSchema = z.object({
  ruleId: z.string().uuid("Choose a valid matching rule."),
  ruleType: z.enum(["payer_alias", "description_customer", "reference_template", "accepted_fee_behavior"]).default("payer_alias"),
}).strict();
const ruleIdField = { ruleId: z.string().uuid("Choose a valid matching rule.") };
const updateSchema = z.union([
  payerCreateSchema.extend(ruleIdField),
  descriptionCreateSchema.extend(ruleIdField),
  referenceCreateSchema.extend(ruleIdField),
  feeCreateSchema.extend(ruleIdField),
]);

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;

async function authenticatedClient(): Promise<
  | { ok: true; supabase: ServerSupabaseClient }
  | { ok: false; response: NextResponse }
> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, response: NextResponse.json({ error: "Matching rule storage is not configured." }, { status: 503 }) };
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    logServerError(error, { operation: "payer_mapping_auth", code: error.code });
    return { ok: false, response: NextResponse.json({ error: "Matching rule storage is temporarily unavailable." }, { status: 503 }) };
  }
  if (!data.user) return { ok: false, response: NextResponse.json({ error: "Sign in to manage matching rules." }, { status: 401 }) };
  return { ok: true, supabase };
}

async function mutationContext(
  request: Request,
  params: Promise<{ workspaceId: string }>,
): Promise<
  | { ok: true; workspaceId: string; supabase: ServerSupabaseClient; headers: Record<string, string> }
  | { ok: false; response: NextResponse }
> {
  if (!verifySameOrigin(request)) return { ok: false, response: NextResponse.json({ error: "Invalid request origin." }, { status: 403 }) };
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "matching-rule"),
    prefix: "matching-rule",
    limit: 60,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: limit.source === "unavailable" ? "Matching rule storage is temporarily unavailable." : "Too many matching rule changes. Wait a moment and try again." },
        { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) },
      ),
    };
  }
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) return { ok: false, response: NextResponse.json({ error: "Choose a valid workspace." }, { status: 400, headers: rateLimitHeaders(limit) }) };
  const auth = await authenticatedClient();
  if (!auth.ok) return auth;
  return { ok: true, workspaceId: parsedParams.data.workspaceId, supabase: auth.supabase, headers: rateLimitHeaders(limit) };
}

function rpcError(error: { code?: string; message?: string }, operation: string, headers: Record<string, string>) {
  if (error.code === "42501") return NextResponse.json({ error: "You do not have permission to manage matching rules in this workspace." }, { status: 403, headers });
  if (error.code === "22023") return NextResponse.json({ error: error.message || "The matching rule is invalid." }, { status: 400, headers });
  if (error.code === "23505") return NextResponse.json({ error: error.message || "This source pattern already has an active rule." }, { status: 409, headers });
  if (error.code === "P0001" && error.message?.includes("Business or Bookkeeper")) {
    return NextResponse.json({
      error: "Description, reference, and fee-review rules require a Business or Bookkeeper plan.",
      upgradeRequired: true,
      upgradeUrl: "/settings/billing",
    }, { status: 402, headers });
  }
  logServerError(error, { operation, code: error.code });
  return NextResponse.json({ error: "The matching rule could not be saved. No rule was changed." }, { status: 503, headers });
}

function customRpcArguments(
  workspaceId: string,
  rule: z.infer<typeof descriptionCreateSchema> | z.infer<typeof referenceCreateSchema> | z.infer<typeof feeCreateSchema>,
) {
  return {
    p_workspace_id: workspaceId,
    p_rule_type: rule.type === "description_customer"
      ? "description_pattern"
      : rule.type === "reference_template" ? "reference_pattern" : "fee_behavior",
    p_source_pattern: rule.pattern,
    p_customer_id: rule.type === "description_customer" ? rule.customerId : null,
    p_maximum_fee_minor: rule.type === "accepted_fee_behavior" ? rule.maximumFeeMinor : null,
    p_maximum_fee_basis_points: rule.type === "accepted_fee_behavior" ? rule.maximumFeeBasisPoints : null,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const context = await mutationContext(request, params);
  if (!context.ok) return context.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid matching rule." }, { status: 400, headers: context.headers });
  }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "The matching rule is invalid." }, { status: 400, headers: context.headers });

  let rpcName: "create_workspace_payer_mapping" | "create_workspace_custom_matching_rule";
  let args: Record<string, unknown>;
  if ("alias" in parsed.data) {
    rpcName = "create_workspace_payer_mapping";
    args = { p_workspace_id: context.workspaceId, p_alias: parsed.data.alias, p_customer_id: parsed.data.customerId };
  } else {
    rpcName = "create_workspace_custom_matching_rule";
    args = customRpcArguments(context.workspaceId, parsed.data);
  }
  const { data, error } = await context.supabase.rpc(rpcName, args);
  if (error) return rpcError(error, rpcName, context.headers);
  if (!data || typeof data !== "object" || !("rule" in data)) {
    logServerError(new Error("Matching rule RPC returned an invalid result"), { operation: rpcName });
    return NextResponse.json({ error: "The saved matching rule could not be confirmed." }, { status: 503, headers: context.headers });
  }
  return NextResponse.json(data, { status: 201, headers: { ...context.headers, "Cache-Control": "private, no-store" } });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const context = await mutationContext(request, params);
  if (!context.ok) return context.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose a matching rule to delete." }, { status: 400, headers: context.headers });
  }
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "The matching rule is invalid." }, { status: 400, headers: context.headers });

  const rpcName = parsed.data.ruleType === "payer_alias"
    ? "delete_workspace_payer_mapping"
    : "delete_workspace_custom_matching_rule";
  const { data, error } = await context.supabase.rpc(rpcName, {
    p_workspace_id: context.workspaceId,
    p_rule_id: parsed.data.ruleId,
  });
  if (error) return rpcError(error, rpcName, context.headers);
  if (!data || typeof data !== "object" || !("deleted" in data)) {
    logServerError(new Error("Matching rule delete RPC returned an invalid result"), { operation: rpcName });
    return NextResponse.json({ error: "The deleted matching rule could not be confirmed." }, { status: 503, headers: context.headers });
  }
  return NextResponse.json(data, { status: 200, headers: { ...context.headers, "Cache-Control": "private, no-store" } });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const context = await mutationContext(request, params);
  if (!context.ok) return context.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid matching rule." }, { status: 400, headers: context.headers });
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "The matching rule is invalid." }, { status: 400, headers: context.headers });

  let rpcName: "update_workspace_payer_mapping" | "update_workspace_custom_matching_rule";
  let args: Record<string, unknown>;
  if ("alias" in parsed.data) {
    rpcName = "update_workspace_payer_mapping";
    args = {
      p_workspace_id: context.workspaceId,
      p_rule_id: parsed.data.ruleId,
      p_alias: parsed.data.alias,
      p_customer_id: parsed.data.customerId,
    };
  } else {
    rpcName = "update_workspace_custom_matching_rule";
    args = { ...customRpcArguments(context.workspaceId, parsed.data), p_rule_id: parsed.data.ruleId };
  }
  const { data, error } = await context.supabase.rpc(rpcName, args);
  if (error) return rpcError(error, rpcName, context.headers);
  if (!data || typeof data !== "object" || !("rule" in data)) {
    logServerError(new Error("Matching rule update RPC returned an invalid result"), { operation: rpcName });
    return NextResponse.json({ error: "The updated matching rule could not be confirmed." }, { status: 503, headers: context.headers });
  }
  return NextResponse.json(data, { status: 200, headers: { ...context.headers, "Cache-Control": "private, no-store" } });
}
