import { SettingsPanel } from "@/components/app/settings-panel";
import type { OrganizationTeamMember } from "@/components/app/team-panel";
import { getCurrentUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await getCurrentUser({ allowPublicDemo: workspaceId === "demo" });
  if (user?.source === "demo") return <SettingsPanel isDemo />;
  const supabase = await getSupabaseServerClient();
  if (!supabase || !user) return <SettingsPanel isDemo={false} />;
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id,organization_id,business_name,currency_code,timezone,accounting_basis,match_days_after")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace) return <SettingsPanel isDemo={false} />;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("transactional_import_emails")
    .eq("id", user.id)
    .maybeSingle();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const role = String(membership?.role || "viewer");
  const canManageTeam = role === "owner" || role === "admin";
  let teamMembers: OrganizationTeamMember[] | null = canManageTeam ? null : [];
  let teamPlanEligible = false;
  if (canManageTeam) {
    const [teamResult, subscriptionResult] = await Promise.all([
      supabase.rpc("get_organization_team", { p_organization_id: workspace.organization_id }),
      supabase
        .from("subscriptions")
        .select("plan_code,status")
        .eq("organization_id", workspace.organization_id)
        .maybeSingle(),
    ]);
    const activeSubscription = !subscriptionResult.error && subscriptionResult.data
      && ["active", "trialing", "past_due"].includes(String(subscriptionResult.data.status));
    teamPlanEligible = Boolean(activeSubscription && ["business", "bookkeeper"].includes(String(subscriptionResult.data?.plan_code)));
    if (!teamResult.error && Array.isArray(teamResult.data)) {
      const parsed = teamResult.data.flatMap((value): OrganizationTeamMember[] => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const row = value as Record<string, unknown>;
        if (typeof row.membership_id !== "string" || typeof row.member_email !== "string"
            || !["owner", "admin", "member", "viewer"].includes(String(row.member_role))
            || !["active", "invited", "expired", "suspended"].includes(String(row.member_status))) return [];
        return [{
          membershipId: row.membership_id,
          email: row.member_email,
          displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : undefined,
          role: row.member_role as OrganizationTeamMember["role"],
          status: row.member_status as OrganizationTeamMember["status"],
          invitedAt: typeof row.invited_at === "string" ? row.invited_at : undefined,
          joinedAt: typeof row.joined_at === "string" ? row.joined_at : undefined,
          expiresAt: typeof row.invitation_expires_at === "string" ? row.invitation_expires_at : undefined,
        }];
      });
      teamMembers = parsed.length === teamResult.data.length ? parsed : null;
    }
  }
  return <SettingsPanel
    isDemo={false}
    workspaceId={workspaceId}
    organizationId={String(workspace.organization_id)}
    canEdit={role === "owner" || role === "admin"}
    canDelete={role === "owner"}
    teamMembers={teamMembers}
    teamPlanEligible={teamPlanEligible}
    initialTransactionalImportEmails={profileError || !profile ? null : profile.transactional_import_emails !== false}
    initialSettings={{
      businessName: String(workspace.business_name),
      currency: String(workspace.currency_code),
      timezone: String(workspace.timezone),
      accountingBasis: workspace.accounting_basis === "cash" ? "cash" : "accrual",
      matchDaysAfter: Number(workspace.match_days_after),
    }}
  />;
}
