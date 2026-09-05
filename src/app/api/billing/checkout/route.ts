import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/access";
import { paidPlanSchema } from "@/lib/billing/catalog";
import {
  completeCheckoutIntent,
  expireCheckoutIntent,
  parseCheckoutIntentReservation,
  verifiedCheckoutSessionUrl,
  type CheckoutIntentReservation,
} from "@/lib/billing/checkout-intents";
import { resolveBillingOrganization, safeReturnPath } from "@/lib/billing/http";
import { getStripeClient, verifiedStripePrice } from "@/lib/billing/stripe";
import { incompatibleBillingAccount, isCompatibleStripeCustomer } from "@/lib/billing/customer";
import { siteConfig } from "@/lib/config";
import { logger, logServerError } from "@/lib/logger";
import {
  checkRateLimit,
  privacySafeRequestKey,
  rateLimitHeaders,
  verifySameOrigin,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  plan: paidPlanSchema,
  organizationId: z.string().uuid().optional(),
  returnTo: z.string().max(500).optional(),
}).strict();

function checkoutUrl(path: string, state: "canceled" | "success") {
  const url = new URL(path, siteConfig.url);
  url.hash = "";
  url.searchParams.set("checkout", state);
  return url.toString();
}

async function reserveCheckoutIntent(
  supabase: SupabaseClient,
  organizationId: string,
  plan: z.infer<typeof paidPlanSchema>,
  priceId: string,
): Promise<{ ok: true; value: CheckoutIntentReservation } | { ok: false }> {
  const { data, error } = await supabase.rpc("reserve_stripe_checkout_intent", {
    p_organization_id: organizationId,
    p_plan_code: plan,
    p_provider_price_id: priceId,
  });
  if (error) return { ok: false };
  const value = parseCheckoutIntentReservation(data, { plan, priceId });
  return value ? { ok: true, value } : { ok: false };
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") || 0) > 8_192) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }

  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "billing-checkout"),
    prefix: "billing-checkout",
    limit: 20,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    const status = limit.source === "unavailable" ? 503 : 429;
    return NextResponse.json(
      { error: status === 503 ? "Billing is temporarily unavailable" : "Too many checkout attempts" },
      { status, headers: rateLimitHeaders(limit) },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: rateLimitHeaders(limit) });
  }
  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout request" }, { status: 400, headers: rateLimitHeaders(limit) });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const organization = await resolveBillingOrganization(user, parsed.data.organizationId);
  if (!organization.ok) {
    return NextResponse.json({ error: organization.code }, { status: organization.status });
  }

  const stripe = getStripeClient();
  if (!stripe) return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });

  try {
    const price = await verifiedStripePrice(stripe, parsed.data.plan);
    if (!price.ok) {
      logger.error({ code: price.code, plan: parsed.data.plan }, "Stripe price configuration failed validation");
      return NextResponse.json({ error: "This plan is temporarily unavailable" }, { status: 503 });
    }
    const returnPath = safeReturnPath(parsed.data.returnTo, "/app");
    const metadata = {
      organizationId: organization.organizationId,
      plan: parsed.data.plan,
      userId: user.id,
    };
    let reserved = await reserveCheckoutIntent(
      organization.supabase,
      organization.organizationId,
      parsed.data.plan,
      price.priceId,
    );
    if (!reserved.ok) {
      return NextResponse.json({ error: "Checkout authorization is temporarily unavailable" }, {
        status: 503,
        headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
      });
    }
    for (let recoveryAttempt = 0; recoveryAttempt < 2; recoveryAttempt += 1) {
      const intent = reserved.value;
      if (!intent.allowed) {
        const existing = intent.code === "existing_subscription";
        const creating = intent.code === "checkout_creation_in_progress";
        return NextResponse.json({
          error: existing
            ? "An existing subscription must be managed in the billing portal"
            : creating
              ? "Checkout is being prepared in another tab. Retry in about two minutes."
              : "An open checkout already exists for another plan. Reopen that plan, or wait up to 31 minutes for it to expire before switching plans.",
          code: intent.code,
        }, {
          status: 409,
          headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
        });
      }

      if (intent.status === "ready") {
        const session = await stripe.checkout.sessions.retrieve(intent.provider_session_id, {
          expand: ["line_items.data.price"],
        });
        if (session.status === "expired") {
          const expired = await expireCheckoutIntent(intent.intent_id, intent.provider_session_id);
          if (!expired.ok) {
            return NextResponse.json({ error: "Checkout recovery is temporarily unavailable" }, {
              status: 503,
              headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
            });
          }
          reserved = await reserveCheckoutIntent(
            organization.supabase,
            organization.organizationId,
            parsed.data.plan,
            price.priceId,
          );
          if (!reserved.ok) {
            return NextResponse.json({ error: "Checkout recovery is temporarily unavailable" }, {
              status: 503,
              headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
            });
          }
          continue;
        }
        if (session.status === "complete") {
          return NextResponse.json({
            error: "This subscription checkout is already complete. Refresh billing in a moment.",
            code: "checkout_already_completed",
          }, {
            status: 409,
            headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
          });
        }
        const recoveredUrl = verifiedCheckoutSessionUrl(session, {
          organizationId: organization.organizationId,
          plan: parsed.data.plan,
          priceId: price.priceId,
        });
        if (!recoveredUrl) {
          return NextResponse.json({ error: "The pending checkout could not be verified" }, {
            status: 503,
            headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
          });
        }
        return NextResponse.json({ url: recoveredUrl, recovered: true }, {
          headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
        });
      }

      const { data: existingSubscription, error: subscriptionError } = await organization.supabase
        .from("subscriptions")
        .select("provider_customer_id")
        .eq("organization_id", organization.organizationId)
        .maybeSingle();
      if (subscriptionError) {
        return NextResponse.json({ error: "Billing records are temporarily unavailable" }, {
          status: 503,
          headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
        });
      }
      const customerId = existingSubscription?.provider_customer_id as string | null | undefined;
      if (customerId && !await isCompatibleStripeCustomer(stripe, customerId)) {
        return NextResponse.json(incompatibleBillingAccount, { status: 409 });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: price.priceId, quantity: 1 }],
        customer: customerId || undefined,
        customer_email: customerId ? undefined : user.email,
        client_reference_id: organization.organizationId,
        metadata,
        subscription_data: { metadata },
        success_url: checkoutUrl(returnPath, "success"),
        cancel_url: checkoutUrl(returnPath, "canceled"),
        allow_promotion_codes: true,
        expires_at: Math.floor(Date.now() / 1_000) + 31 * 60,
        expand: ["line_items.data.price"],
      }, {
        idempotencyKey: `invoice-reconcile:checkout:${intent.intent_id}`,
      });
      const checkoutSessionUrl = verifiedCheckoutSessionUrl(session, {
        organizationId: organization.organizationId,
        plan: parsed.data.plan,
        priceId: price.priceId,
      });
      if (!checkoutSessionUrl) throw new Error("Stripe returned an invalid Checkout session");
      const committed = await completeCheckoutIntent({
        intentId: intent.intent_id,
        leaseToken: intent.lease_token,
        providerSessionId: session.id,
        sessionExpiresAt: new Date(session.expires_at * 1_000).toISOString(),
      });
      if (!committed.ok) {
        // The URL has not been released. Best-effort expiration also prevents a
        // database/webhook race from leaving a second usable Stripe session.
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (expirationError) {
          logServerError(expirationError, { operation: "stripe_checkout_expire_uncommitted" });
        }
        return NextResponse.json({ error: "Checkout was created but could not be committed safely. Retry shortly." }, {
          status: 503,
          headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
        });
      }
      logger.info({ plan: parsed.data.plan }, "Stripe Checkout session created");
      return NextResponse.json({ url: checkoutSessionUrl }, {
        headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: "Checkout recovery is temporarily unavailable" }, {
      status: 503,
      headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" },
    });
  } catch (error) {
    logServerError(error, { operation: "stripe_checkout", plan: parsed.data.plan });
    return NextResponse.json({ error: "Checkout could not be started" }, { status: 502 });
  }
}
