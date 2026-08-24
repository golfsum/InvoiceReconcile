import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSupabaseServiceClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));

const subscription = {
  organizationId: "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0",
  providerCustomerId: "cus_test",
  providerSubscriptionId: "sub_test",
  providerPriceId: "price_solo_test",
  planCode: "solo" as const,
  status: "active" as const,
  unitAmountMinor: 1_900,
  quantity: 1,
  currencyCode: "USD",
  billingInterval: "month" as const,
  paidStartedAt: "2026-08-09T00:00:00.000Z",
  trialEndsAt: null,
  currentPeriodStartsAt: "2026-08-23T00:00:00.000Z",
  currentPeriodEndsAt: "2026-09-23T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  canceledAt: null,
};

const event = {
  eventId: "evt_subscription_updated_test",
  eventType: "customer.subscription.updated" as const,
  eventCreatedAt: "2026-08-23T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Stripe subscription event persistence", () => {
  it("sends normalized state and the signed event cursor to the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, outcome: "stale" }, error: null });
    const from = vi.fn();
    getSupabaseServiceClient.mockReturnValue({ rpc, from });
    const { persistStripeSubscription } = await import("@/lib/billing/subscriptions");

    await expect(persistStripeSubscription(subscription, event)).resolves.toEqual({
      ok: true,
      outcome: "stale",
    });
    expect(rpc).toHaveBeenCalledWith("apply_stripe_subscription_event", {
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_event_created_at: event.eventCreatedAt,
      p_organization_id: subscription.organizationId,
      p_provider_customer_id: subscription.providerCustomerId,
      p_provider_subscription_id: subscription.providerSubscriptionId,
      p_provider_price_id: subscription.providerPriceId,
      p_plan_code: subscription.planCode,
      p_status: subscription.status,
      p_unit_amount_minor: subscription.unitAmountMinor,
      p_quantity: subscription.quantity,
      p_currency_code: subscription.currencyCode,
      p_billing_interval: subscription.billingInterval,
      p_paid_started_at: subscription.paidStartedAt,
      p_trial_ends_at: subscription.trialEndsAt,
      p_current_period_starts_at: subscription.currentPeriodStartsAt,
      p_current_period_ends_at: subscription.currentPeriodEndsAt,
      p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
      p_canceled_at: subscription.canceledAt,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic state transition fails", async () => {
    getSupabaseServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "23505" } }),
    });
    const { persistStripeSubscription } = await import("@/lib/billing/subscriptions");

    await expect(persistStripeSubscription(subscription, event)).resolves.toEqual({
      ok: false,
      code: "subscription_persist_failed",
    });
  });

  it("fails closed on an unrecognized database outcome", async () => {
    getSupabaseServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: { ok: true, outcome: "pending" }, error: null }),
    });
    const { persistStripeSubscription } = await import("@/lib/billing/subscriptions");

    await expect(persistStripeSubscription(subscription, event)).resolves.toEqual({
      ok: false,
      code: "subscription_persist_failed",
    });
  });
});
