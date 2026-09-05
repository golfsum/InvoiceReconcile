import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function subscriptionFixture(priceId = "price_solo_test", status: Stripe.Subscription.Status = "active") {
  return {
    id: "sub_test",
    object: "subscription",
    created: 1_786_233_600,
    customer: "cus_test",
    metadata: { organizationId: "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0", plan: "solo" },
    status,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    items: {
      data: [{
        current_period_start: 1_787_443_200,
        current_period_end: 1_790_121_600,
        quantity: 1,
        price: {
          id: priceId,
          active: false,
          currency: "usd",
          recurring: { interval: "month" },
          unit_amount: 1_900,
        },
      }],
    },
  } as unknown as Stripe.Subscription;
}

describe("Stripe subscription normalization", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_PRICE_SOLO", "price_solo_test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes a configured subscription into the database contract", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    const result = normalizeStripeSubscription(subscriptionFixture());
    expect(result).toMatchObject({
      ok: true,
      value: {
        organizationId: "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0",
        providerCustomerId: "cus_test",
        providerSubscriptionId: "sub_test",
        planCode: "solo",
        status: "active",
        unitAmountMinor: 1_900,
        billingInterval: "month",
        paidStartedAt: "2026-08-09T00:00:00.000Z",
      },
    });
  });

  it("allows an archived configured price for cancellation synchronization", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(subscriptionFixture()).ok).toBe(true);
  });

  it("recognizes portal cancellation scheduled at the current period end", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    const fixture = subscriptionFixture();
    fixture.cancel_at = fixture.items.data[0].current_period_end;
    expect(normalizeStripeSubscription(fixture)).toMatchObject({ ok: true, value: { cancelAtPeriodEnd: true } });
    fixture.cancel_at += 86400;
    expect(normalizeStripeSubscription(fixture)).toMatchObject({ ok: true, value: { cancelAtPeriodEnd: false } });
  });

  it.each(["active", "past_due", "unpaid", "paused", "canceled"] as const)("preserves %s for entitlement decisions", async (status) => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(subscriptionFixture("price_solo_test", status))).toMatchObject({ ok: true, value: { status } });
  });

  it("does not label an incomplete subscription as paid", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(subscriptionFixture("price_solo_test", "incomplete"))).toMatchObject({
      ok: true,
      value: { status: "incomplete", paidStartedAt: null },
    });
  });

  it("rejects an unknown Stripe price", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(subscriptionFixture("price_other"))).toEqual({
      ok: false,
      code: "unknown_price",
    });
  });

  it("rejects conflicting checkout and subscription organization metadata", async () => {
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(
      subscriptionFixture(),
      "11000000-0000-4000-8000-000000000001",
    )).toEqual({
      ok: false,
      code: "organization_mismatch",
    });
  });

  it("rejects malformed organization metadata before using the service role", async () => {
    const fixture = subscriptionFixture();
    fixture.metadata.organizationId = "not-an-organization-id";
    const { normalizeStripeSubscription } = await import("@/lib/billing/subscriptions");
    expect(normalizeStripeSubscription(fixture)).toEqual({
      ok: false,
      code: "organization_invalid",
    });
  });
});
