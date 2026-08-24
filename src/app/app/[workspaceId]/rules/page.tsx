import { RulesPanel } from "@/components/app/rules-panel";
import { getCurrentUser } from "@/lib/auth/access";
import { loadWorkspaceMatchingRuleCatalog } from "@/lib/reconciliation/workspace-rules";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function RulesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await getCurrentUser({ allowPublicDemo: workspaceId === "demo" });
  if (!user) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(`/app/${workspaceId}/rules`)}`);
  if (user.source === "demo") return <RulesPanel mode="demo" />;

  const supabase = await getSupabaseServerClient();
  if (!supabase) return <RulesPanel mode="unavailable" />;
  const [workspaceResult, catalogResult] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id,organization_id")
      .eq("id", workspaceId)
      .eq("status", "active")
      .maybeSingle(),
    loadWorkspaceMatchingRuleCatalog(supabase, workspaceId),
  ]);
  if (workspaceResult.error || catalogResult.status === "unavailable") return <RulesPanel mode="unavailable" />;
  if (!workspaceResult.data) redirect("/app");

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("role")
    .eq("organization_id", workspaceResult.data.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership) return <RulesPanel mode="unavailable" />;
  const role = String(membership.role);
  return <RulesPanel
    mode="live"
    workspaceId={workspaceId}
    initialRules={catalogResult.catalog.payerMappings}
    initialCustomRules={catalogResult.catalog.customRules}
    customers={catalogResult.catalog.customers}
    customRulesEnabled={catalogResult.catalog.customRulesEnabled}
    plan={catalogResult.catalog.plan}
    canEdit={role === "owner" || role === "admin" || role === "member"}
  />;
}
