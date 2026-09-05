import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getStripeClient = vi.hoisted(() => vi.fn());
const getStripeWebhookSecret = vi.hoisted(() => vi.fn());
const findOrganizationForSubscription = vi.hoisted(() => vi.fn());
const normalizeStripeSubscription = vi.hoisted(() => vi.fn());
const persistStripeSubscription = vi.hoisted(() => vi.fn());
const markCheckoutIntentCompleted = vi.hoisted(() => vi.fn());

vi.mock("@/lib/billing/stripe", () => ({ getStripeClient, getStripeWebhookSecret }));
vi.mock("@/lib/billing/subscriptions", () => ({
  findOrganizationForSubscription,
  normalizeStripeSubscription,
  persistStripeSubscription,
}));
vi.mock("@/lib/billing/checkout-intents", () => ({ markCheckoutIntentCompleted }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
  logServerError: vi.fn(),
}));

const normalizedSubscription = {
  organizationId: "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0",
  providerCustomerId: "cus_test",
  providerSubscriptionId: "sub_test",
  providerPriceId: "price_solo_test",
  planCode: "solo",
  status: "canceled",
  unitAmountMinor: 1_900,
  quantity: 1,
  currencyCode: "USD",
  billingInterval: "month",
  paidStartedAt: "2026-08-09T00:00:00.000Z",
  trialEndsAt: null,
  currentPeriodStartsAt: "2026-08-23T00:00:00.000Z",
  currentPeriodEndsAt: "2026-09-23T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  canceledAt: "2026-08-23T12:00:00.000Z",
};

const event = {
  id: "evt_subscription_deleted_test",
  livemode: false,
  object: "event",
  created: 1_787_486_400,
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: "sub_test",
      metadata: { organizationId: normalizedSubscription.organizationId },
    },
  },
} as unknown as Stripe.Event;

function request() {
  return new Request("https://invoicereconcile.com/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "signed_test_event" },
    body: "signed payload",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_BILLING_MODE", "test");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture");
  const constructEvent = vi.fn().mockReturnValue(event);
  getStripeClient.mockReturnValue({ webhooks: { constructEvent } });
  getStripeWebhookSecret.mockReturnValue("whsec_test");
  normalizeStripeSubscription.mockReturnValue({ ok: true, value: normalizedSubscription });
  markCheckoutIntentCompleted.mockResolvedValue({ ok: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("Stripe webhook event ordering boundary", () => {
  it("rejects a correctly signed event from the wrong mode without writing data", async () => {
    getStripeClient.mockReturnValue({ webhooks: { constructEvent: vi.fn().mockReturnValue({ ...event, livemode: true }) } });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    expect((await POST(request())).status).toBe(400);
    expect(persistStripeSubscription).not.toHaveBeenCalled();
    expect(markCheckoutIntentCompleted).not.toHaveBeenCalled();
  });

  it.each(["past_due", "unpaid", "active"])("persists the %s renewal lifecycle update", async (status) => {
    const update = { ...event, type: "customer.subscription.updated" };
    getStripeClient.mockReturnValue({ webhooks: { constructEvent: vi.fn().mockReturnValue(update) } });
    normalizeStripeSubscription.mockReturnValue({ ok: true, value: { ...normalizedSubscription, status } });
    persistStripeSubscription.mockResolvedValue({ ok: true, outcome: "applied" });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    expect((await POST(request())).status).toBe(200);
    expect(persistStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status }), expect.objectContaining({ eventType: "customer.subscription.updated" }),
    );
  });

  it("does not acknowledge a signed event when its atomic state write fails", async () => {
    persistStripeSubscription.mockResolvedValue({ ok: false, code: "subscription_persist_failed" });
    const { POST } = await import("@/app/api/webhooks/stripe/route");

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Stripe event could not be persisted" });
    expect(persistStripeSubscription).toHaveBeenCalledWith(normalizedSubscription, {
      eventId: event.id,
      eventType: "customer.subscription.deleted",
      eventCreatedAt: "2026-08-23T12:00:00.000Z",
    });
  });

  it("acknowledges an idempotent duplicate after the database confirms it", async () => {
    persistStripeSubscription.mockResolvedValue({ ok: true, outcome: "duplicate" });
    const { POST } = await import("@/app/api/webhooks/stripe/route");

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it("does not acknowledge Checkout completion until the intent receipt is durable", async () => {
    const checkoutEvent = {
      id: "evt_checkout_completed_test",
      livemode: false,
      object: "event",
      created: 1_787_486_400,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_checkout_intent_123",
          metadata: { organizationId: normalizedSubscription.organizationId },
          subscription: {
            id: "sub_test",
            metadata: { organizationId: normalizedSubscription.organizationId },
          },
        },
      },
    } as unknown as Stripe.Event;
    getStripeClient.mockReturnValue({
      webhooks: { constructEvent: vi.fn().mockReturnValue(checkoutEvent) },
    });
    persistStripeSubscription.mockResolvedValue({ ok: true, outcome: "applied" });
    markCheckoutIntentCompleted.mockResolvedValue({
      ok: false,
      code: "checkout_intent_complete_failed",
    });
    const { POST } = await import("@/app/api/webhooks/stripe/route");

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(markCheckoutIntentCompleted).toHaveBeenCalledWith(
      normalizedSubscription.organizationId,
      "cs_test_checkout_intent_123",
    );
  });
});
