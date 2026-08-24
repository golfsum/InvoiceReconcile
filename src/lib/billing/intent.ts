import { z } from "zod";
import { paidPlanSchema, type PaidPlanKey } from "@/lib/billing/catalog";

const organizationIdSchema = z.string().uuid();

export function selectedPaidPlan(value: unknown): PaidPlanKey | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = paidPlanSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function selectedPaidPlanFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  return selectedPaidPlan((metadata as Record<string, unknown>).selected_plan);
}

export function onboardingPathForPlan(plan: PaidPlanKey | null) {
  return plan ? `/onboarding?plan=${encodeURIComponent(plan)}` : "/onboarding";
}

export function billingPathForPlan(plan: PaidPlanKey, organizationId: string) {
  const validOrganizationId = organizationIdSchema.parse(organizationId);
  const query = new URLSearchParams({ plan, organizationId: validOrganizationId, onboarding: "complete" });
  return `/settings/billing?${query.toString()}`;
}

export function selectedOrganizationId(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = organizationIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
