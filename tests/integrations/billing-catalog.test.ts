import { describe, expect, it } from "vitest";
import {
  BILLING_PLANS,
  configuredPriceId,
  isBillingConfigured,
  planForPriceId,
  validateStripePrice,
} from "@/lib/billing/catalog";

describe("billing catalog", () => {
  it("keeps the displayed monthly plan amounts exact", () => {
    expect(BILLING_PLANS.solo.monthlyAmountMinor).toBe(1_900);
    expect(BILLING_PLANS.business.monthlyAmountMinor).toBe(4_900);
    expect(BILLING_PLANS.bookkeeper.monthlyAmountMinor).toBe(9_900);
  });

  it("maps configured price IDs without hardcoding production values", () => {
    const environment = {
      NODE_ENV: "test",
      STRIPE_PRICE_SOLO: "price_solo_test",
      STRIPE_PRICE_BUSINESS: "price_business_test",
      STRIPE_PRICE_BOOKKEEPER: "price_bookkeeper_test",
    } as unknown as NodeJS.ProcessEnv;
    expect(configuredPriceId("business", environment)).toBe("price_business_test");
    expect(planForPriceId("price_bookkeeper_test", environment)).toBe("bookkeeper");
    expect(planForPriceId("price_unknown", environment)).toBeNull();
  });

  it("reports billing ready only when the complete hosted-checkout configuration exists", () => {
    const complete = {
      STRIPE_BILLING_MODE: "live",
      STRIPE_SECRET_KEY: "sk_live_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_example",
      STRIPE_PRICE_SOLO: "price_solo",
      STRIPE_PRICE_BUSINESS: "price_business",
      STRIPE_PRICE_BOOKKEEPER: "price_bookkeeper",
    } as unknown as NodeJS.ProcessEnv;
    expect(isBillingConfigured(complete)).toBe(true);
    expect(isBillingConfigured({ ...complete, STRIPE_WEBHOOK_SECRET: "" })).toBe(false);
  });

  it("rejects a Stripe price that does not match the plan contract", () => {
    const base = {
      active: true,
      currency: "usd",
      id: "price_test",
      recurring: { interval: "month" },
      unitAmount: 1_900,
    };
    expect(validateStripePrice("solo", base)).toEqual({ valid: true });
    expect(validateStripePrice("solo", { ...base, unitAmount: 2_000 })).toEqual({
      valid: false,
      reason: "amount_mismatch",
    });
    expect(validateStripePrice("solo", { ...base, recurring: { interval: "year" } })).toEqual({
      valid: false,
      reason: "interval_mismatch",
    });
    expect(validateStripePrice("solo", { ...base, recurring: { interval: "month", intervalCount: 3 } })).toEqual({
      valid: false,
      reason: "interval_count_mismatch",
    });
  });
});
