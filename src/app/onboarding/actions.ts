"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { paidPlanSchema } from "@/lib/billing/catalog";
import { billingPathForPlan } from "@/lib/billing/intent";

export type OnboardingState = { error?: string };

const schema = z.object({
  businessName: z.string().trim().min(2, "Enter the business or firm name.").max(200),
  organizationType: z.enum(["business", "bookkeeping_firm", "accounting_firm"]),
  currency: z.enum(["USD", "CAD", "EUR", "GBP", "AUD"]),
  timezone: z.string().trim().min(1).max(100),
  accountingBasis: z.enum(["cash", "accrual"]),
  matchDaysAfter: z.coerce.number().int().min(1, "Choose a matching window of at least 1 day.").max(365, "Choose a matching window of 365 days or fewer."),
  selectedPlan: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    paidPlanSchema.optional(),
  ),
});

export async function createWorkspaceAction(_state: OnboardingState, formData: FormData): Promise<OnboardingState> {
  await requireUser("/onboarding");
  const parsed = schema.safeParse({ businessName: formData.get("businessName"), organizationType: formData.get("organizationType"), currency: formData.get("currency"), timezone: formData.get("timezone"), accountingBasis: formData.get("accountingBasis"), matchDaysAfter: formData.get("matchDaysAfter"), selectedPlan: formData.get("selectedPlan") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the workspace details." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Workspace creation is not configured in this environment. Use the sample workspace instead." };
  const { data, error } = await supabase.rpc("create_initial_workspace", {
    p_business_name: parsed.data.businessName,
    p_organization_type: parsed.data.organizationType,
    p_currency_code: parsed.data.currency,
    p_timezone: parsed.data.timezone,
    p_accounting_basis: parsed.data.accountingBasis,
    p_match_days_after: parsed.data.matchDaysAfter,
  });
  const first = Array.isArray(data) ? data[0] : data;
  const workspaceId = first && typeof first === "object" && "workspace_id" in first ? String(first.workspace_id) : null;
  const organizationId = first && typeof first === "object" && "organization_id" in first ? String(first.organization_id) : null;
  if (error || !workspaceId) return { error: "We could not create the workspace. Try again or contact support@invoicereconcile.com." };
  if (parsed.data.selectedPlan) {
    if (!organizationId || !z.string().uuid().safeParse(organizationId).success) return { error: "We created the workspace but could not safely start billing. Open Plan and billing from the app to continue." };
    await supabase.auth.updateUser({ data: { selected_plan: null } });
    redirect(billingPathForPlan(parsed.data.selectedPlan, organizationId));
  }
  redirect(`/app/${workspaceId}/imports`);
}
