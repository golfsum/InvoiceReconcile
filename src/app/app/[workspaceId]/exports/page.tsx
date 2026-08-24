import { WorkspaceExports } from "@/components/app/workspace-data";
import { LargeExportPanel } from "@/components/app/export-panel";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { loadLatestReconciliationOverview } from "@/lib/reconciliation/large-run";

export default async function ExportsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") return <LargeExportPanel workspaceId={workspaceId} runRecordId={overview.data.runRecordId} matchCount={overview.data.metrics.matches} />;
    if (overview.status === "unavailable") return <WorkspaceDataUnavailable />;
    if (overview.status === "empty") return <WorkspaceExports workspaceId={workspaceId} initialData={null} initialLoadStatus="empty" />;
  }
  const result = await loadLatestReconciliationRun(workspaceId);
  return <WorkspaceExports workspaceId={workspaceId} initialData={result.status === "ready" ? result.data : null} initialLoadStatus={result.status} />;
}
