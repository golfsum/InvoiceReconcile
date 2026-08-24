import "server-only";

import Stripe from "stripe";
import {
  configuredPriceId,
  type PaidPlanKey,
  validateStripePrice,
} from "@/lib/billing/catalog";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  stripeClient ??= new Stripe(secretKey, { typescript: true });
  return stripeClient;
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export async function verifiedStripePrice(stripe: Stripe, plan: PaidPlanKey) {
  const priceId = configuredPriceId(plan);
  if (!priceId) return { ok: false as const, code: "price_not_configured" };
  const price = await stripe.prices.retrieve(priceId);
  const validation = validateStripePrice(plan, {
    active: price.active,
    currency: price.currency,
    id: price.id,
    recurring: price.recurring ? { interval: price.recurring.interval } : null,
    unitAmount: price.unit_amount,
  });
  if (!validation.valid) return { ok: false as const, code: validation.reason };
  return { ok: true as const, priceId: price.id };
}
