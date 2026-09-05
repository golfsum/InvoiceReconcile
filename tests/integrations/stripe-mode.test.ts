import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stripeBillingMode, stripeObjectMatchesMode } from "@/lib/billing/mode";

vi.mock("server-only", () => ({}));

const testEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_fixture" };
const liveEnvironment: NodeJS.ProcessEnv = { NODE_ENV: "test", STRIPE_BILLING_MODE: "live", STRIPE_SECRET_KEY: "sk_live_fixture", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture" };
afterEach(() => vi.unstubAllEnvs());

describe("Stripe mode isolation", () => {
  it("defaults to sandbox and requires explicit live opt-in", () => {
    expect(stripeBillingMode(testEnvironment)).toBe("test");
    expect(stripeBillingMode(liveEnvironment)).toBe("live");
    expect(stripeBillingMode({ ...liveEnvironment, STRIPE_BILLING_MODE: undefined })).toBeNull();
  });
  it("blocks live billing in previews and mismatched keys", () => {
    expect(stripeBillingMode({ ...liveEnvironment, VERCEL_ENV: "preview" })).toBeNull();
    expect(stripeBillingMode({ ...liveEnvironment, VERCEL_ENV: "development" })).toBeNull();
    expect(stripeBillingMode({ ...liveEnvironment, VERCEL_ENV: "production" })).toBe("live");
    expect(stripeBillingMode({ ...testEnvironment, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_fixture" })).toBeNull();
    expect(stripeObjectMatchesMode({ livemode: true }, testEnvironment)).toBe(false);
  });
  it.each([
    [{ id: "cus_fixture", livemode: false }, true],
    [{ id: "cus_fixture", livemode: true }, false],
    [{ id: "cus_fixture", deleted: true }, false],
  ])("validates saved Stripe customers", async (customer, expected) => {
    for (const [key, value] of Object.entries(testEnvironment)) vi.stubEnv(key, value);
    vi.stubEnv("STRIPE_BILLING_MODE", "test");
    const { isCompatibleStripeCustomer } = await import("@/lib/billing/customer");
    const stripe = { customers: { retrieve: vi.fn().mockResolvedValue(customer) } } as unknown as Stripe;
    expect(await isCompatibleStripeCustomer(stripe, "cus_fixture")).toBe(expected);
  });
  it("distinguishes missing legacy customers from transient Stripe errors", async () => {
    const { isCompatibleStripeCustomer } = await import("@/lib/billing/customer");
    const retrieve = vi.fn().mockRejectedValue({ code: "resource_missing" });
    const stripe = { customers: { retrieve } } as unknown as Stripe;
    expect(await isCompatibleStripeCustomer(stripe, "cus_fixture")).toBe(false);
    retrieve.mockRejectedValue(new Error("network unavailable"));
    await expect(isCompatibleStripeCustomer(stripe, "cus_fixture")).rejects.toThrow("network unavailable");
  });
});
