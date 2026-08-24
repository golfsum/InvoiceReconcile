import "server-only";

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { z } from "zod";
import {
  BILLING_PLANS,
  planForPriceId,
  type PaidPlanKey,
  validateStripePrice,
} from "@/lib/billing/catalog";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const organizationIdSchema = z.string().uuid();

export type StripeSubscriptionEvent = {
  eventId: string;
  eventType:
    | "checkout.session.completed"
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted";
  eventCreatedAt: string;
};

export type StripeSubscriptionEventOutcome = "applied" | "duplicate" | "stale";

export type SubscriptionWrite = {
  organizationId: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  providerPriceId: string;
  planCode: PaidPlanKey;
  status: "active" | "canceled" | "incomplete" | "past_due" | "paused" | "trialing" | "unpaid";
  unitAmountMinor: number;
  quantity: number;
  currencyCode: string;
  billingInterval: "month" | "year";
  paidStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
};

function timestampToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1_000).toISOString() : null;
}

function customerId(customer: Stripe.Subscription["customer"]) {
  return typeof customer === "string" ? customer : customer.id;
}

function normalizeStatus(status: Stripe.Subscription.Status): SubscriptionWrite["status"] {
  switch (status) {
    case "active":
      return "active";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    case "trialing":
      return "trialing";
    case "unpaid":
      return "unpaid";
    case "incomplete_expired":
      return "canceled";
    default:
      return "incomplete";
  }
}

export function normalizeStripeSubscription(
  subscription: Stripe.Subscription,
  fallbackOrganizationId?: string,
): { ok: true; value: SubscriptionWrite } | { ok: false; code: string } {
  const item = subscription.items.data[0];
  if (!item) return { ok: false, code: "subscription_item_missing" };
  const price = item.price;
  const plan = planForPriceId(price.id);
  if (!plan) return { ok: false, code: "unknown_price" };
  const validation = validateStripePrice(plan, {
    active: price.active,
    currency: price.currency,
    id: price.id,
    recurring: price.recurring ? { interval: price.recurring.interval } : null,
    unitAmount: price.unit_amount,
  }, { requireActive: false });
  if (!validation.valid) return { ok: false, code: validation.reason };

  const metadataOrganizationId = subscription.metadata.organizationId?.trim() || undefined;
  const fallback = fallbackOrganizationId?.trim() || undefined;
  if (metadataOrganizationId && fallback && metadataOrganizationId !== fallback) {
    return { ok: false, code: "organization_mismatch" };
  }
  const organizationId = metadataOrganizationId || fallback;
  if (!organizationId) return { ok: false, code: "organization_missing" };
  if (!organizationIdSchema.safeParse(organizationId).success) {
    return { ok: false, code: "organization_invalid" };
  }
  const stripeInterval = price.recurring?.interval;
  const interval = stripeInterval === "month" ? "month" : stripeInterval === "year" ? "year" : null;
  if (!interval) return { ok: false, code: "interval_mismatch" };
  const status = normalizeStatus(subscription.status);
  const hasObservedPaidLifecycle = ["active", "past_due", "unpaid", "paused", "canceled"].includes(subscription.status);

  return {
    ok: true,
    value: {
      organizationId,
      providerCustomerId: customerId(subscription.customer),
      providerSubscriptionId: subscription.id,
      providerPriceId: price.id,
      planCode: plan,
      status,
      unitAmountMinor: price.unit_amount ?? BILLING_PLANS[plan].monthlyAmountMinor,
      quantity: item.quantity || 1,
      currencyCode: price.currency.toUpperCase(),
      billingInterval: interval,
      paidStartedAt: hasObservedPaidLifecycle ? timestampToIso(subscription.created) : null,
      trialEndsAt: timestampToIso(subscription.trial_end),
      currentPeriodStartsAt: timestampToIso(item.current_period_start),
      currentPeriodEndsAt: timestampToIso(item.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: timestampToIso(subscription.canceled_at),
    },
  };
}

function subscriptionEventId(providerSubscriptionId: string) {
  const hex = createHash("sha256").update(`subscription_started:${providerSubscriptionId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function recordSubscriptionStarted(
  supabase: NonNullable<ReturnType<typeof getSupabaseServiceClient>>,
  value: SubscriptionWrite,
) {
  if (!new Set(["trialing", "active", "past_due"]).has(value.status)) return;
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", value.organizationId)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .not("user_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership?.user_id) return;
  await supabase.from("analytics_events").upsert({
    event_id: subscriptionEventId(value.providerSubscriptionId),
    event_name: "subscription_started",
    occurred_at: value.paidStartedAt || new Date().toISOString(),
    user_id: membership.user_id,
    organization_id: value.organizationId,
    path: "/settings/billing",
    properties: { plan: value.planCode, result: "completed" },
  }, { onConflict: "event_id", ignoreDuplicates: true });
}

export async function findOrganizationForSubscription(providerSubscriptionId: string) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { ok: false as const, code: "billing_storage_unavailable" };
  const { data, error } = await supabase
    .from("subscriptions")
    .select("organization_id")
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();
  if (error) return { ok: false as const, code: "subscription_lookup_failed" };
  return { ok: true as const, organizationId: data?.organization_id as string | undefined };
}

export async function persistStripeSubscription(
  value: SubscriptionWrite,
  event: StripeSubscriptionEvent,
) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return { ok: false as const, code: "billing_storage_unavailable" };
  const { data, error } = await supabase.rpc("apply_stripe_subscription_event", {
    p_event_id: event.eventId,
    p_event_type: event.eventType,
    p_event_created_at: event.eventCreatedAt,
    p_organization_id: value.organizationId,
    p_provider_customer_id: value.providerCustomerId,
    p_provider_subscription_id: value.providerSubscriptionId,
    p_provider_price_id: value.providerPriceId,
    p_plan_code: value.planCode,
    p_status: value.status,
    p_unit_amount_minor: value.unitAmountMinor,
    p_quantity: value.quantity,
    p_currency_code: value.currencyCode,
    p_billing_interval: value.billingInterval,
    p_paid_started_at: value.paidStartedAt,
    p_trial_ends_at: value.trialEndsAt,
    p_current_period_starts_at: value.currentPeriodStartsAt,
    p_current_period_ends_at: value.currentPeriodEndsAt,
    p_cancel_at_period_end: value.cancelAtPeriodEnd,
    p_canceled_at: value.canceledAt,
  });
  if (error) return { ok: false as const, code: "subscription_persist_failed" };
  const outcome = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { outcome?: unknown }).outcome
    : undefined;
  if (outcome !== "applied" && outcome !== "duplicate" && outcome !== "stale") {
    return { ok: false as const, code: "subscription_persist_failed" };
  }
  if (outcome === "applied") await recordSubscriptionStarted(supabase, value);
  return { ok: true as const, outcome: outcome as StripeSubscriptionEventOutcome };
}
