import { WorkspaceReview } from "@/components/app/workspace-data";
import { LargeReviewQueue } from "@/components/app/large-review-queue";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { loadLatestReconciliationOverview, loadLatestReconciliationPage } from "@/lib/reconciliation/large-run";
import type { ProposedMatch } from "@/lib/reconciliation";

export default async function ExceptionsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") {
      const page = await loadLatestReconciliationPage<ProposedMatch>({ workspaceId, itemType: "match", offset: 0, limit: 50 });
      if (page.status === "ready") return <LargeReviewQueue workspaceId={workspaceId} initialPage={{ ...page.data, itemType: "match" }} />;
      return <WorkspaceDataUnavailable />;
    }
    if (overview.status === "unavailable") return <WorkspaceDataUnavailable />;
    if (overview.status === "empty") return <WorkspaceReview workspaceId={workspaceId} initialData={null} initialLoadStatus="empty" />;
  }
  const result = await loadLatestReconciliationRun(workspaceId);
  return <WorkspaceReview workspaceId={workspaceId} initialData={result.status === "ready" ? result.data : null} initialLoadStatus={result.status} />;
}
