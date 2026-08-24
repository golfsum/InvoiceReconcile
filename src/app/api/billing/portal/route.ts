import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/access";
import { resolveBillingOrganization, safeReturnPath } from "@/lib/billing/http";
import { getStripeClient } from "@/lib/billing/stripe";
import { siteConfig } from "@/lib/config";
import { logServerError } from "@/lib/logger";
import {
  checkRateLimit,
  privacySafeRequestKey,
  rateLimitHeaders,
  verifySameOrigin,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

const portalSchema = z.object({
  organizationId: z.string().uuid().optional(),
  returnTo: z.string().max(500).optional(),
}).strict();

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "billing-portal"),
    prefix: "billing-portal",
    limit: 20,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    const status = limit.source === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: status === 503 ? "Billing is temporarily unavailable" : "Too many requests" }, {
      status,
      headers: rateLimitHeaders(limit),
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = portalSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid portal request" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const organization = await resolveBillingOrganization(user, parsed.data.organizationId);
  if (!organization.ok) return NextResponse.json({ error: organization.code }, { status: organization.status });
  const { data: subscription, error } = await organization.supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("organization_id", organization.organizationId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Billing records are unavailable" }, { status: 503 });
  const customerId = subscription?.provider_customer_id as string | null | undefined;
  if (!customerId) return NextResponse.json({ error: "No billing account exists yet" }, { status: 409 });
  const stripe = getStripeClient();
  if (!stripe) return NextResponse.json({ error: "Billing is not configured" }, { status: 503 });

  try {
    const returnPath = safeReturnPath(parsed.data.returnTo, "/app");
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: new URL(returnPath, siteConfig.url).toString(),
    });
    return NextResponse.json({ url: session.url }, { headers: rateLimitHeaders(limit) });
  } catch (portalError) {
    logServerError(portalError, { operation: "stripe_portal" });
    return NextResponse.json({ error: "Billing portal could not be opened" }, { status: 502 });
  }
}
