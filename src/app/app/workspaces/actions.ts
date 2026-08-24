"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type WorkspaceActionState = { error?: string; success?: string };

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const workspaceSchema = z.object({
  organizationId: z.string().uuid("Choose an organization."),
  businessName: z.string().trim().min(2, "Enter a client or business name.").max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, "Choose a valid three-letter currency code."),
  timezone: z.string().trim().min(1).max(100).refine(validTimezone, "Choose a valid timezone."),
  accountingBasis: z.enum(["cash", "accrual"]),
  matchDaysAfter: z.coerce.number().int().min(1).max(365),
});

const settingsSchema = workspaceSchema.omit({ organizationId: true }).extend({
  workspaceId: z.string().uuid("Choose a valid workspace."),
});

const deleteSchema = z.object({
  workspaceId: z.string().uuid("Choose a valid workspace."),
  confirmation: z.literal("DELETE", { error: "Type DELETE exactly to confirm." }),
});

const importEmailPreferenceSchema = z.object({
  workspaceId: z.string().uuid("Choose a valid workspace."),
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});

function workspaceError(error: { code?: string; message?: string } | null, fallback: string) {
  const message = error?.message || "";
  if (message.includes("plan supports")) return `${message}. Upgrade the organization plan or remove an unused workspace.`;
  if (message.includes("organization is not active")) return "This organization is not active, so a workspace cannot be added.";
  if (message.includes("Cancel the paid subscription")) return "Cancel the paid subscription from Billing before deleting its only workspace.";
  if (message.includes("Only an organization owner")) return "Only an organization owner can delete this workspace.";
  if (message.includes("Private import source deletion must be confirmed")) return "Remove each pending private import source and wait for confirmed deletion before deleting this workspace.";
  if (message.includes("administration access")) return "An organization owner or admin must change these settings.";
  if (error?.code === "42501") return "You do not have permission to make this workspace change.";
  return fallback;
}

export async function createAdditionalWorkspaceAction(
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  await requireUser("/app/workspaces");
  const parsed = workspaceSchema.safeParse({
    organizationId: formData.get("organizationId"),
    businessName: formData.get("businessName"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
    accountingBasis: formData.get("accountingBasis"),
    matchDaysAfter: formData.get("matchDaysAfter"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the workspace details." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Workspace creation is not configured in this environment." };
  const { data, error } = await supabase.rpc("create_additional_workspace", {
    p_organization_id: parsed.data.organizationId,
    p_business_name: parsed.data.businessName,
    p_currency_code: parsed.data.currency,
    p_timezone: parsed.data.timezone,
    p_accounting_basis: parsed.data.accountingBasis,
    p_match_days_after: parsed.data.matchDaysAfter,
  });
  const workspaceId = typeof data === "string" && z.string().uuid().safeParse(data).success ? data : null;
  if (error || !workspaceId) return { error: workspaceError(error, "We could not create the workspace. Try again or contact support@invoicereconcile.com.") };
  revalidatePath("/app", "layout");
  redirect(`/app/${workspaceId}/imports`);
}

export async function updateWorkspaceSettingsAction(
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const workspaceId = String(formData.get("workspaceId") || "");
  await requireUser(`/app/${workspaceId}/settings`);
  const parsed = settingsSchema.safeParse({
    workspaceId,
    businessName: formData.get("businessName"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
    accountingBasis: formData.get("accountingBasis"),
    matchDaysAfter: formData.get("matchDaysAfter"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the workspace settings." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Workspace settings are not configured in this environment." };
  const { error } = await supabase.rpc("update_workspace_settings", {
    p_workspace_id: parsed.data.workspaceId,
    p_business_name: parsed.data.businessName,
    p_currency_code: parsed.data.currency,
    p_timezone: parsed.data.timezone,
    p_accounting_basis: parsed.data.accountingBasis,
    p_match_days_after: parsed.data.matchDaysAfter,
  });
  if (error) return { error: workspaceError(error, "We could not save the workspace settings. Try again.") };
  revalidatePath(`/app/${parsed.data.workspaceId}`, "layout");
  revalidatePath("/app/workspaces");
  return { success: "Workspace settings saved." };
}

export async function updateImportEmailPreferenceAction(
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const workspaceId = String(formData.get("workspaceId") || "");
  const user = await requireUser(`/app/${workspaceId}/settings`);
  const parsed = importEmailPreferenceSchema.safeParse({
    workspaceId,
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Choose an import email preference." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Notification preferences are not configured in this environment." };
  const { data, error } = await supabase
    .from("profiles")
    .update({ transactional_import_emails: parsed.data.enabled })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "We could not save the import email preference. Try again." };
  revalidatePath(`/app/${parsed.data.workspaceId}/settings`);
  return { success: parsed.data.enabled ? "Import status emails enabled." : "Import status emails disabled." };
}

export async function deleteWorkspaceAction(
  _state: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const workspaceId = String(formData.get("workspaceId") || "");
  await requireUser(`/app/${workspaceId}/settings`);
  const parsed = deleteSchema.safeParse({ workspaceId, confirmation: formData.get("confirmation") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Confirm workspace deletion." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Workspace deletion is not configured in this environment." };
  const { error } = await supabase.rpc("delete_workspace_with_audit", {
    p_workspace_id: parsed.data.workspaceId,
    p_confirmation: parsed.data.confirmation,
  });
  if (error) return { error: workspaceError(error, "We could not delete the workspace. Try again or contact support@invoicereconcile.com.") };
  revalidatePath("/app", "layout");
  redirect("/app/workspaces");
}
