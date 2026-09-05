import "server-only";

import { z } from "zod";
import type { AppUser } from "@/lib/auth/access";
import { resolveBillingOrganization } from "@/lib/billing/http";
import { plans } from "@/lib/config";

const subscriptionSchema = z.object({
  plan_code: z.enum(["free", "solo", "business", "bookkeeper"]),
  status: z.enum(["active", "trialing", "past_due", "incomplete", "unpaid", "paused", "canceled"]),
  provider_customer_id: z.string().nullable(),
  provider_subscription_id: z.string().nullable(),
  current_period_ends_at: z.string().datetime({ offset: true }).nullable(),
  cancel_at_period_end: z.boolean(),
});

export async function loadBillingSummary(user: AppUser, requestedOrganizationId?: string) {
  const organization = await resolveBillingOrganization(user, requestedOrganizationId);
  if (!organization.ok) return { ok: false as const, code: organization.code };
  const { data, error } = await organization.supabase.from("subscriptions")
    .select("plan_code,status,provider_customer_id,provider_subscription_id,current_period_ends_at,cancel_at_period_end")
    .eq("organization_id", organization.organizationId).maybeSingle();
  const parsed = subscriptionSchema.nullable().safeParse(data);
  if (error || !parsed.success) return { ok: false as const, code: "billing_storage_unavailable" };
  const subscription = parsed.data;
  const paidAccess = Boolean(subscription && ["active", "trialing", "past_due"].includes(subscription.status));
  const plan = plans.find((item) => item.key === (paidAccess ? subscription?.plan_code : "free"))!;
  return {
    ok: true as const,
    organizationId: organization.organizationId,
    plan,
    status: subscription?.status || "active",
    hasBillingAccount: Boolean(subscription?.provider_customer_id),
    hasSubscription: Boolean(subscription?.provider_subscription_id && subscription.status !== "canceled"),
    cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
    periodEndsAt: subscription?.current_period_ends_at || null,
  };
}
