import { LargeWorkspaceDashboard, WorkspaceDashboard } from "@/components/app/workspace-dashboard";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadLatestReconciliationOverview } from "@/lib/reconciliation/large-run";

export default async function WorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  let workspaceName = "Northstar Services";
  if (workspaceId !== "demo") {
    const supabase = await getSupabaseServerClient();
    const { data: workspace } = await supabase!.from("workspaces").select("name,business_name").eq("id", workspaceId).maybeSingle();
    workspaceName = String(workspace?.business_name || workspace?.name || "Current workspace");
  }
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") return <LargeWorkspaceDashboard workspaceId={workspaceId} workspaceName={workspaceName} overview={overview.data} />;
    if (overview.status === "unavailable") return <WorkspaceDataUnavailable />;
    if (overview.status === "empty") return <WorkspaceDashboard workspaceId={workspaceId} workspaceName={workspaceName} data={null} />;
  }
  const result = await loadLatestReconciliationRun(workspaceId);
  if (result.status === "unavailable") return <WorkspaceDataUnavailable />;
  return <WorkspaceDashboard workspaceId={workspaceId} workspaceName={workspaceName} data={result.status === "ready" ? result.data : null} />;
}
