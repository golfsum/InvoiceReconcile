import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const webhookSecret = "whsec_invoice_reconcile_test";
const payload = JSON.stringify({
  id: "evt_signature_test",
  object: "event",
  api_version: "2026-03-25.dahlia",
  created: 1_787_468_400,
  data: { object: { id: "prod_test", object: "product" } },
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type: "product.created",
});

describe("Stripe webhook signature boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_invoice_reconcile");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
  });

  it("rejects an invalid signature before processing the event", async () => {
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "invalid" },
      body: payload,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid Stripe signature" });
  });

  it("accepts a correctly signed, non-mutating Stripe event", async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const { POST } = await import("@/app/api/webhooks/stripe/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
  });
});
