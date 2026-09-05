import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const getCurrentUser = vi.hoisted(() => vi.fn());
const resolveBillingOrganization = vi.hoisted(() => vi.fn());
const getStripeClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/access", () => ({ getCurrentUser }));
vi.mock("@/lib/billing/http", async () => ({
  ...await vi.importActual<typeof import("@/lib/billing/http")>("@/lib/billing/http"), resolveBillingOrganization,
}));
vi.mock("@/lib/billing/stripe", () => ({ getStripeClient }));
vi.mock("@/lib/logger", () => ({ logServerError: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_BILLING_MODE", "test");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_fixture");
  getCurrentUser.mockResolvedValue({ id: "user-1", source: "supabase" });
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { provider_customer_id: "cus_fixture" }, error: null }) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  resolveBillingOrganization.mockResolvedValue({ ok: true, organizationId: "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0", supabase: { from: vi.fn().mockReturnValue(query) } });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
});
describe("Stripe portal customer mode boundary", () => {
  it.each([false, true])("checks customer compatibility before opening the portal (live=%s)", async (livemode) => {
    const create = vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/p/session/test" });
    getStripeClient.mockReturnValue({ customers: { retrieve: vi.fn().mockResolvedValue({ id: "cus_fixture", livemode }) }, billingPortal: { sessions: { create } } });
    const { POST } = await import("@/app/api/billing/portal/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/billing/portal", {
      method: "POST", headers: { origin: "https://invoicereconcile.com", "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(livemode ? 409 : 200);
    expect(create).toHaveBeenCalledTimes(livemode ? 0 : 1);
  });
});
