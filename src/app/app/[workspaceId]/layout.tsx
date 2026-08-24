import { WorkspaceShell } from "@/components/app/workspace-shell";
import { getCurrentUser } from "@/lib/auth/access";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { demoClients } from "@/lib/demo/workspace";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { loadLatestReconciliationOverview } from "@/lib/reconciliation/large-run";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await getCurrentUser({ allowPublicDemo: workspaceId === "demo" });
  if (!user) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(`/app/${workspaceId}`)}`);
  let workspaces: Array<{ id: string; name: string }> = demoClients.map((client) => ({ id: client.id, name: client.name }));
  if (user.source === "supabase") {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase!.from("workspaces").select("id,name,business_name").eq("status", "active").order("name");
    workspaces = (data || []).map((workspace) => ({ id: String(workspace.id), name: String(workspace.business_name || workspace.name) }));
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) redirect("/app/workspaces");
  } else if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    redirect("/app/demo");
  }
  let exceptionCount: number | null;
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") exceptionCount = overview.data.metrics.exceptions;
    else if (overview.status === "empty") exceptionCount = 0;
    else if (overview.status === "unavailable") exceptionCount = null;
    else {
      const legacy = await loadLatestReconciliationRun(workspaceId);
      const latest = legacy.status === "ready" ? legacy.data : null;
      exceptionCount = legacy.status === "unavailable" ? null : latest?.result.matches.filter((match) => !latest.decisions?.[match.id] && (match.confidence === "review" || match.confidence === "unmatched")).length || 0;
    }
  } else {
    const demo = await loadLatestReconciliationRun(workspaceId);
    const latest = demo.status === "ready" ? demo.data : null;
    exceptionCount = demo.status === "unavailable" ? null : latest?.result.matches.filter((match) => !latest.decisions?.[match.id] && (match.confidence === "review" || match.confidence === "unmatched")).length || 0;
  }
  return <Suspense fallback={<div className="min-h-screen bg-background" />}><WorkspaceShell workspaceId={workspaceId} userName={user.name} isDemo={user.source === "demo"} exceptionCount={exceptionCount} workspaces={workspaces}>{children}</WorkspaceShell></Suspense>;
}
