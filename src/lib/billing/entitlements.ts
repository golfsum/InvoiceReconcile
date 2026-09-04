import { z } from "zod";
import { normalizeEntitlementRpc } from "@/lib/reconciliation/rpc-result";

export const entitlementPlanSchema = z.enum(["free", "solo", "business", "bookkeeper"]);
export type EntitlementPlan = z.infer<typeof entitlementPlanSchema>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const commonEntitlementFields = {
  plan: entitlementPlanSchema,
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  requested: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  period_start: dateSchema,
  period_end: dateSchema,
  existing: z.boolean(),
};

const reconciliationEntitlementSchema = z.discriminatedUnion("allowed", [
  z.object({
    allowed: z.literal(true),
    code: z.enum(["allowed", "already_reserved", "already_processed"]),
    ...commonEntitlementFields,
    reservation_id: z.string().uuid().optional(),
  }),
  z.object({
    allowed: z.literal(false),
    code: z.literal("payment_limit_exceeded"),
    ...commonEntitlementFields,
  }),
]);

export type ReconciliationEntitlement = z.infer<typeof reconciliationEntitlementSchema>;
export type PaymentLimitExceeded = Extract<ReconciliationEntitlement, { allowed: false }>;

export function parseReconciliationEntitlement(value: unknown): ReconciliationEntitlement | null {
  const parsed = reconciliationEntitlementSchema.safeParse(normalizeEntitlementRpc(value));
  return parsed.success ? parsed.data : null;
}

export function entitlementPlanName(plan: EntitlementPlan) {
  if (plan === "bookkeeper") return "Bookkeeper";
  if (plan === "business") return "Business";
  if (plan === "solo") return "Solo";
  return "Free";
}

export function paymentLimitExceededMessage(entitlement: PaymentLimitExceeded) {
  const paymentLabel = entitlement.requested === 1 ? "payment" : "payments";
  return `This run includes ${entitlement.requested.toLocaleString("en-US")} ${paymentLabel}, which would exceed the ${entitlement.limit.toLocaleString("en-US")}-payment monthly limit on the ${entitlementPlanName(entitlement.plan)} plan.`;
}

export function paymentLimitResponse(entitlement: PaymentLimitExceeded) {
  return {
    error: paymentLimitExceededMessage(entitlement),
    code: entitlement.code,
    upgradeRequired: true,
    upgradeUrl: "/settings/billing",
    entitlement: {
      plan: entitlement.plan,
      limit: entitlement.limit,
      used: entitlement.used,
      requested: entitlement.requested,
      remaining: entitlement.remaining,
      periodStart: entitlement.period_start,
      periodEnd: entitlement.period_end,
    },
  } as const;
}
