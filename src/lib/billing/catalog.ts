import { z } from "zod";

export const paidPlanSchema = z.enum(["solo", "business", "bookkeeper"]);
export type PaidPlanKey = z.infer<typeof paidPlanSchema>;

export type BillingPlan = {
  key: PaidPlanKey;
  name: string;
  monthlyAmountMinor: number;
  priceEnvironmentVariable: string;
};

export const BILLING_PLANS: Record<PaidPlanKey, BillingPlan> = {
  solo: {
    key: "solo",
    name: "Solo",
    monthlyAmountMinor: 1_900,
    priceEnvironmentVariable: "STRIPE_PRICE_SOLO",
  },
  business: {
    key: "business",
    name: "Business",
    monthlyAmountMinor: 4_900,
    priceEnvironmentVariable: "STRIPE_PRICE_BUSINESS",
  },
  bookkeeper: {
    key: "bookkeeper",
    name: "Bookkeeper",
    monthlyAmountMinor: 9_900,
    priceEnvironmentVariable: "STRIPE_PRICE_BOOKKEEPER",
  },
};

export type StripePriceShape = {
  active: boolean;
  currency: string;
  id: string;
  recurring: { interval: string } | null;
  unitAmount: number | null;
};

export function configuredPriceId(plan: PaidPlanKey, environment: NodeJS.ProcessEnv = process.env) {
  return environment[BILLING_PLANS[plan].priceEnvironmentVariable]?.trim() || null;
}

export function isBillingConfigured(environment: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    environment.STRIPE_SECRET_KEY?.trim()
    && environment.STRIPE_WEBHOOK_SECRET?.trim()
    && environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
    && configuredPriceId("solo", environment)
    && configuredPriceId("business", environment)
    && configuredPriceId("bookkeeper", environment),
  );
}

export function planForPriceId(priceId: string, environment: NodeJS.ProcessEnv = process.env) {
  return (Object.keys(BILLING_PLANS) as PaidPlanKey[]).find(
    (plan) => configuredPriceId(plan, environment) === priceId,
  ) ?? null;
}

export function validateStripePrice(
  plan: PaidPlanKey,
  price: StripePriceShape,
  options: { requireActive?: boolean } = {},
) {
  const expected = BILLING_PLANS[plan];
  if ((options.requireActive ?? true) && !price.active) {
    return { valid: false as const, reason: "price_inactive" };
  }
  if (price.currency.toLowerCase() !== "usd") return { valid: false as const, reason: "currency_mismatch" };
  if (price.recurring?.interval !== "month") return { valid: false as const, reason: "interval_mismatch" };
  if (price.unitAmount !== expected.monthlyAmountMinor) {
    return { valid: false as const, reason: "amount_mismatch" };
  }
  return { valid: true as const };
}
