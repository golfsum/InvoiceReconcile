import { plans } from "@/lib/config";

export const planWorkspaceLimits = { free: 1, solo: 1, business: 3, bookkeeper: 20 } as const;

// A marketing estimate, never an authorization or entitlement decision.
export function recommendPlan(payments: number, workspaces: number, customRules: boolean) {
  if (!Number.isSafeInteger(payments) || payments < 0 || !Number.isSafeInteger(workspaces) || workspaces < 1) return null;
  return plans.find((plan) => payments <= plan.paymentLimit
    && workspaces <= planWorkspaceLimits[plan.key]
    && (!customRules || plan.key === "business" || plan.key === "bookkeeper")) ?? null;
}
