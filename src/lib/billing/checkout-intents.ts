import "server-only";

import type Stripe from "stripe";
import { z } from "zod";
import { paidPlanSchema, type PaidPlanKey } from "@/lib/billing/catalog";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { stripeObjectMatchesMode } from "@/lib/billing/mode";

const intentIdSchema = z.string().uuid();
const leaseTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const priceIdSchema = z.string().regex(/^price_[A-Za-z0-9_]{1,240}$/);
const sessionIdSchema = z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9_]{1,240}$/);

const claimedIntentSchema = z.object({
  allowed: z.literal(true),
  status: z.literal("claimed"),
  intent_id: intentIdSchema,
  lease_token: leaseTokenSchema,
  plan: paidPlanSchema,
  provider_price_id: priceIdSchema,
}).passthrough();

const readyIntentSchema = z.object({
  allowed: z.literal(true),
  status: z.literal("ready"),
  intent_id: intentIdSchema,
  plan: paidPlanSchema,
  provider_price_id: priceIdSchema,
  provider_session_id: sessionIdSchema,
  session_expires_at: z.string().datetime({ offset: true }),
}).passthrough();

const deniedIntentSchema = z.object({
  allowed: z.literal(false),
  code: z.enum([
    "existing_subscription",
    "checkout_already_pending",
    "checkout_creation_in_progress",
  ]),
}).passthrough();

const reservationSchema = z.union([claimedIntentSchema, readyIntentSchema, deniedIntentSchema]);

export type CheckoutIntentReservation = z.infer<typeof reservationSchema>;

export function parseCheckoutIntentReservation(
  value: unknown,
  expected: { plan: PaidPlanKey; priceId: string },
): CheckoutIntentReservation | null {
  const parsed = reservationSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.allowed
      && (parsed.data.plan !== expected.plan || parsed.data.provider_price_id !== expected.priceId)) {
    return null;
  }
  return parsed.data;
}

function checkoutPriceId(session: Stripe.Checkout.Session) {
  const price = session.line_items?.data[0]?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

export function verifiedCheckoutSessionUrl(
  session: Stripe.Checkout.Session,
  expected: { organizationId: string; plan: PaidPlanKey; priceId: string },
) {
  if (!stripeObjectMatchesMode(session)
      || session.mode !== "subscription"
      || session.client_reference_id !== expected.organizationId
      || session.metadata?.organizationId !== expected.organizationId
      || session.metadata?.plan !== expected.plan
      || checkoutPriceId(session) !== expected.priceId
      || session.status !== "open"
      || !session.url) return null;
  try {
    const url = new URL(session.url);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function completeCheckoutIntent(input: {
  intentId: string;
  leaseToken: string;
  providerSessionId: string;
  sessionExpiresAt: string;
}) {
  const service = getSupabaseServiceClient();
  if (!service) return { ok: false as const, code: "checkout_storage_unavailable" };
  const { data, error } = await service.rpc("complete_stripe_checkout_intent", {
    p_intent_id: input.intentId,
    p_lease_token: input.leaseToken,
    p_provider_session_id: input.providerSessionId,
    p_session_expires_at: input.sessionExpiresAt,
  });
  const status = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { status?: unknown }).status
    : null;
  return !error && status === "ready"
    ? { ok: true as const }
    : { ok: false as const, code: "checkout_intent_commit_failed" };
}

export async function expireCheckoutIntent(intentId: string, providerSessionId: string) {
  const service = getSupabaseServiceClient();
  if (!service) return { ok: false as const, code: "checkout_storage_unavailable" };
  const { data, error } = await service.rpc("expire_stripe_checkout_intent", {
    p_intent_id: intentId,
    p_provider_session_id: providerSessionId,
  });
  const status = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { status?: unknown }).status
    : null;
  return !error && status === "expired"
    ? { ok: true as const }
    : { ok: false as const, code: "checkout_intent_expire_failed" };
}

export async function markCheckoutIntentCompleted(organizationId: string, providerSessionId: string) {
  const service = getSupabaseServiceClient();
  if (!service) return { ok: false as const, code: "checkout_storage_unavailable" };
  const { data, error } = await service.rpc("mark_stripe_checkout_intent_completed", {
    p_organization_id: organizationId,
    p_provider_session_id: providerSessionId,
  });
  const status = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { status?: unknown }).status
    : null;
  return !error && (status === "completed" || status === "missing")
    ? { ok: true as const }
    : { ok: false as const, code: "checkout_intent_complete_failed" };
}
