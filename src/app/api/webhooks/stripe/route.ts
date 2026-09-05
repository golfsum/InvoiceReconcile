import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/billing/stripe";
import { markCheckoutIntentCompleted } from "@/lib/billing/checkout-intents";
import { stripeObjectMatchesMode } from "@/lib/billing/mode";
import {
  findOrganizationForSubscription,
  normalizeStripeSubscription,
  persistStripeSubscription,
  type StripeSubscriptionEvent,
} from "@/lib/billing/subscriptions";
import { logger, logServerError } from "@/lib/logger";

export const runtime = "nodejs";

async function subscriptionFromCheckout(stripe: Stripe, session: Stripe.Checkout.Session) {
  if (!session.subscription) return null;
  if (typeof session.subscription !== "string") return session.subscription;
  return stripe.subscriptions.retrieve(session.subscription, { expand: ["items.data.price"] });
}

async function synchronizeSubscription(
  subscription: Stripe.Subscription,
  event: StripeSubscriptionEvent,
  fallbackOrganizationId?: string,
  checkoutSessionId?: string,
) {
  let organizationId = fallbackOrganizationId;
  if (!organizationId && !subscription.metadata.organizationId) {
    const lookup = await findOrganizationForSubscription(subscription.id);
    if (!lookup.ok) return lookup;
    organizationId = lookup.organizationId;
  }
  const normalized = normalizeStripeSubscription(subscription, organizationId);
  if (!normalized.ok) return normalized;
  const persisted = await persistStripeSubscription(normalized.value, event);
  if (!persisted.ok || !checkoutSessionId) return persisted;
  const completedIntent = await markCheckoutIntentCompleted(
    normalized.value.organizationId,
    checkoutSessionId,
  );
  return completedIntent.ok ? persisted : completedIntent;
}

async function handleStripeEvent(stripe: Stripe, event: Stripe.Event) {
  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    return synchronizeSubscription(event.data.object, {
      eventId: event.id,
      eventType: event.type,
      eventCreatedAt: new Date(event.created * 1_000).toISOString(),
    });
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const subscription = await subscriptionFromCheckout(stripe, session);
    if (!subscription) return { ok: true as const, ignored: true as const };
    return synchronizeSubscription(subscription, {
      eventId: event.id,
      eventType: event.type,
      eventCreatedAt: new Date(event.created * 1_000).toISOString(),
    }, session.metadata?.organizationId || undefined, session.id);
  }
  return { ok: true as const, ignored: true as const };
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  if (Number(request.headers.get("content-length") || 0) > 1_048_576) {
    return NextResponse.json({ error: "Stripe event is too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  if (!stripeObjectMatchesMode(event)) {
    return NextResponse.json({ error: "Stripe event mode does not match this environment" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(stripe, event);
    if (!result.ok) {
      logger.error({ eventId: event.id, eventType: event.type, code: result.code }, "Stripe event could not be persisted");
      return NextResponse.json({ error: "Stripe event could not be persisted" }, { status: 503 });
    }
    logger.info({
      eventId: event.id,
      eventType: event.type,
      ignored: "ignored" in result,
      outcome: "outcome" in result ? result.outcome : undefined,
    }, "Stripe webhook accepted");
    return NextResponse.json({ received: true });
  } catch (error) {
    logServerError(error, { operation: "stripe_webhook", eventId: event.id, eventType: event.type });
    return NextResponse.json({ error: "Stripe event processing failed" }, { status: 500 });
  }
}
