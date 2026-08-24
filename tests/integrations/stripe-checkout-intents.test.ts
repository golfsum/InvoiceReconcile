import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCurrentUser = vi.hoisted(() => vi.fn());
const resolveBillingOrganization = vi.hoisted(() => vi.fn());
const getStripeClient = vi.hoisted(() => vi.fn());
const verifiedStripePrice = vi.hoisted(() => vi.fn());
const getSupabaseServiceClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/access", () => ({ getCurrentUser }));
vi.mock("@/lib/billing/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/http")>("@/lib/billing/http");
  return { ...actual, resolveBillingOrganization };
});
vi.mock("@/lib/billing/stripe", () => ({ getStripeClient, verifiedStripePrice }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
  logServerError: vi.fn(),
}));

const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";
const intentId = "53cc8ba4-f56d-42ea-99bb-6b4b08324095";
const leaseToken = "a".repeat(64);
const sessionId = "cs_test_checkout_intent_123";
const priceId = "price_solo_test";
const expiresAt = Math.floor(Date.now() / 1_000) + 31 * 60;

function request() {
  return new Request("https://invoicereconcile.com/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
    body: JSON.stringify({ plan: "solo", organizationId, returnTo: "/settings/billing" }),
  });
}

function subscriptionQuery(customerId: string | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: customerId ? { provider_customer_id: customerId } : null,
    error: null,
  });
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    }),
  };
}

function openSession() {
  return {
    id: sessionId,
    mode: "subscription",
    client_reference_id: organizationId,
    metadata: { organizationId, plan: "solo", userId: "user-1" },
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_test_checkout_intent_123",
    expires_at: expiresAt,
    line_items: { data: [{ price: { id: priceId } }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: "user-1",
    email: "owner@example.com",
    source: "supabase",
    role: "member",
  });
  verifiedStripePrice.mockResolvedValue({ ok: true, priceId });
});

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
});

describe("Stripe Checkout intent boundary", () => {
  it("rejects a second subscription when the database reports an existing one", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { allowed: false, code: "existing_subscription" },
      error: null,
    });
    const userStorage = { ...subscriptionQuery(), rpc };
    const create = vi.fn();
    resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId, supabase: userStorage });
    getStripeClient.mockReturnValue({ checkout: { sessions: { create } } });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "existing_subscription" });
    expect(create).not.toHaveBeenCalled();
  });

  it("explains how to recover or wait when another plan already has an open session", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { allowed: false, code: "checkout_already_pending", plan: "business" },
      error: null,
    });
    const userStorage = { ...subscriptionQuery(), rpc };
    const create = vi.fn();
    resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId, supabase: userStorage });
    getStripeClient.mockReturnValue({ checkout: { sessions: { create } } });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "checkout_already_pending",
      error: expect.stringMatching(/Reopen that plan.*31 minutes/i),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("recovers the same verified open session across tabs without creating another", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        allowed: true,
        status: "ready",
        intent_id: intentId,
        plan: "solo",
        provider_price_id: priceId,
        provider_session_id: sessionId,
        session_expires_at: new Date(expiresAt * 1_000).toISOString(),
      },
      error: null,
    });
    const userStorage = { ...subscriptionQuery(), rpc };
    const retrieve = vi.fn().mockResolvedValue(openSession());
    const create = vi.fn();
    resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId, supabase: userStorage });
    getStripeClient.mockReturnValue({ checkout: { sessions: { create, retrieve } } });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//),
      recovered: true,
    });
    expect(retrieve).toHaveBeenCalledWith(sessionId, { expand: ["line_items.data.price"] });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the server intent ID for Stripe idempotency and commits before returning the URL", async () => {
    const userRpc = vi.fn().mockResolvedValue({
      data: {
        allowed: true,
        status: "claimed",
        intent_id: intentId,
        lease_token: leaseToken,
        plan: "solo",
        provider_price_id: priceId,
      },
      error: null,
    });
    const userStorage = { ...subscriptionQuery("cus_existing"), rpc: userRpc };
    const create = vi.fn().mockResolvedValue(openSession());
    const serviceRpc = vi.fn().mockResolvedValue({ data: { ok: true, status: "ready" }, error: null });
    resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId, supabase: userStorage });
    getStripeClient.mockReturnValue({ checkout: { sessions: { create } } });
    getSupabaseServiceClient.mockReturnValue({ rpc: serviceRpc });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      customer: "cus_existing",
      expires_at: expect.any(Number),
      success_url: expect.not.stringContaining("session_id"),
      cancel_url: expect.not.stringContaining("session_id"),
    }), {
      idempotencyKey: `invoice-reconcile:checkout:${intentId}`,
    });
    expect(serviceRpc).toHaveBeenCalledWith("complete_stripe_checkout_intent", expect.objectContaining({
      p_intent_id: intentId,
      p_lease_token: leaseToken,
      p_provider_session_id: sessionId,
    }));
    await expect(response.json()).resolves.toMatchObject({ url: expect.any(String) });
  });

  it("does not release the Checkout URL when the session receipt cannot be committed", async () => {
    const userRpc = vi.fn().mockResolvedValue({
      data: {
        allowed: true,
        status: "claimed",
        intent_id: intentId,
        lease_token: leaseToken,
        plan: "solo",
        provider_price_id: priceId,
      },
      error: null,
    });
    const userStorage = { ...subscriptionQuery(), rpc: userRpc };
    const expire = vi.fn().mockResolvedValue({ ...openSession(), status: "expired", url: null });
    resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId, supabase: userStorage });
    getStripeClient.mockReturnValue({
      checkout: { sessions: { create: vi.fn().mockResolvedValue(openSession()), expire } },
    });
    getSupabaseServiceClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "database_unavailable" } }),
    });

    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(request());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.url).toBeUndefined();
    expect(expire).toHaveBeenCalledWith(sessionId);
  });
});
