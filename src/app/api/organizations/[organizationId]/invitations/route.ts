import { NextResponse } from "next/server";
import { z } from "zod";
import { sendTeamInvitationEmail } from "@/lib/email";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paramsSchema = z.object({ organizationId: z.string().uuid() }).strict();
const invitationSchema = z.object({
  email: z.string().trim().email("Enter a valid colleague email address.").max(320).transform((value) => value.toLowerCase()),
  role: z.enum(["member", "viewer"]),
}).strict();
const revokeSchema = z.object({ membershipId: z.string().uuid("Choose a valid invitation.") }).strict();
const invitationResultSchema = z.object({
  membershipId: z.string().uuid(),
  organizationId: z.string().uuid(),
  organizationName: z.string().trim().min(1).max(200),
  invitedEmail: z.string().email().max(320),
  role: z.enum(["member", "viewer"]),
  status: z.literal("invited"),
  invitedAt: z.string(),
  expiresAt: z.string(),
  deliveryId: z.string().uuid(),
  existing: z.boolean(),
}).strict();

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;

async function mutationContext(request: Request, params: Promise<{ organizationId: string }>): Promise<
  | { ok: true; organizationId: string; supabase: ServerSupabaseClient; headers: Record<string, string> }
  | { ok: false; response: NextResponse }
> {
  if (!verifySameOrigin(request)) return { ok: false, response: NextResponse.json({ error: "Invalid request origin." }, { status: 403 }) };
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) return { ok: false, response: NextResponse.json({ error: "Choose a valid organization." }, { status: 400 }) };
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, `team-invitation:${parsedParams.data.organizationId}`),
    prefix: "team-invitation",
    limit: 10,
    windowSeconds: 3_600,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      response: NextResponse.json({
        error: limit.source === "unavailable"
          ? "Team invitations are temporarily unavailable."
          : "Too many invitation changes. Wait before trying again.",
      }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) }),
    };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false, response: NextResponse.json({ error: "Team invitations are not configured." }, { status: 503, headers: rateLimitHeaders(limit) }) };
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    logServerError(error, { operation: "team_invitation_auth", code: error.code });
    return { ok: false, response: NextResponse.json({ error: "Team invitations are temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) }) };
  }
  if (!data.user) return { ok: false, response: NextResponse.json({ error: "Sign in to invite a colleague." }, { status: 401, headers: rateLimitHeaders(limit) }) };
  return { ok: true, organizationId: parsedParams.data.organizationId, supabase, headers: rateLimitHeaders(limit) };
}

function rpcError(error: { code?: string; message?: string }, headers: Record<string, string>) {
  if (error.code === "42501") return NextResponse.json({ error: "Only an organization owner or admin can manage invitations." }, { status: 403, headers });
  if (error.code === "22023") return NextResponse.json({ error: error.message || "Check the invitation details." }, { status: 400, headers });
  if (error.code === "23505") return NextResponse.json({ error: error.message || "This colleague already belongs to the organization." }, { status: 409, headers });
  if (error.code === "P0001") return NextResponse.json({ error: error.message || "Team invitations require an eligible plan.", upgradeRequired: true, upgradeUrl: "/settings/billing" }, { status: 402, headers });
  logServerError(error, { operation: "team_invitation_rpc", code: error.code });
  return NextResponse.json({ error: "The invitation could not be saved." }, { status: 503, headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const context = await mutationContext(request, params);
  if (!context.ok) return context.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Send valid invitation details." }, { status: 400, headers: context.headers });
  }
  const parsed = invitationSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the invitation details." }, { status: 400, headers: context.headers });

  const { data, error } = await context.supabase.rpc("create_organization_invitation", {
    p_organization_id: context.organizationId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) return rpcError(error, context.headers);
  const invitation = invitationResultSchema.safeParse(data);
  if (!invitation.success || invitation.data.organizationId !== context.organizationId || invitation.data.invitedEmail !== parsed.data.email) {
    logServerError(new Error("Team invitation RPC returned invalid data"), { operation: "team_invitation_result" });
    return NextResponse.json({ error: "The saved invitation could not be confirmed." }, { status: 503, headers: context.headers });
  }

  const delivery = await sendTeamInvitationEmail({
    email: invitation.data.invitedEmail,
    organizationName: invitation.data.organizationName,
    role: invitation.data.role,
  });
  if (!delivery.delivered && delivery.mode !== "demo") {
    if (!invitation.data.existing) {
      const rollback = await context.supabase.rpc("rollback_organization_invitation_delivery", {
        p_organization_id: context.organizationId,
        p_membership_id: invitation.data.membershipId,
        p_delivery_id: invitation.data.deliveryId,
      });
      if (rollback.error) logServerError(rollback.error, { operation: "team_invitation_delivery_rollback", code: rollback.error.code });
      else if (!rollback.data || typeof rollback.data !== "object" || !("rolledBack" in rollback.data)) {
        logServerError(new Error("Invitation delivery rollback returned invalid data"), { operation: "team_invitation_delivery_rollback_result" });
      }
    }
    return NextResponse.json({ error: invitation.data.existing
      ? "The invitation email could not be delivered. The prior invitation remains active."
      : "The invitation email could not be delivered. Try again." }, { status: 503, headers: context.headers });
  }

  return NextResponse.json({
    invitation: {
      membershipId: invitation.data.membershipId,
      email: invitation.data.invitedEmail,
      role: invitation.data.role,
      status: invitation.data.status,
      invitedAt: invitation.data.invitedAt,
      expiresAt: invitation.data.expiresAt,
    },
    delivered: delivery.delivered,
    deliveryMode: delivery.mode,
  }, { status: invitation.data.existing ? 200 : 201, headers: { ...context.headers, "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const context = await mutationContext(request, params);
  if (!context.ok) return context.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose an invitation to revoke." }, { status: 400, headers: context.headers });
  }
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Choose a valid invitation." }, { status: 400, headers: context.headers });
  const { data, error } = await context.supabase.rpc("revoke_organization_invitation", {
    p_organization_id: context.organizationId,
    p_membership_id: parsed.data.membershipId,
  });
  if (error) return rpcError(error, context.headers);
  if (!data || typeof data !== "object" || !("revoked" in data)) {
    logServerError(new Error("Team invitation revoke RPC returned invalid data"), { operation: "team_invitation_revoke_result" });
    return NextResponse.json({ error: "The revoked invitation could not be confirmed." }, { status: 503, headers: context.headers });
  }
  return NextResponse.json(data, { status: 200, headers: { ...context.headers, "Cache-Control": "private, no-store" } });
}
