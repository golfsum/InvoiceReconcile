import { WorkspacePayments } from "@/components/app/workspace-data";
import { LargePaymentTable } from "@/components/app/records-table";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { loadLatestReconciliationOverview, loadLatestReconciliationPage } from "@/lib/reconciliation/large-run";
import type { Payment } from "@/lib/reconciliation";

export default async function PaymentsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") {
      const page = await loadLatestReconciliationPage<Payment>({ workspaceId, itemType: "payment", offset: 0, limit: 50 });
      if (page.status === "ready") return <LargePaymentTable workspaceId={workspaceId} initialPage={page.data} />;
      return <WorkspaceDataUnavailable />;
    }
    if (overview.status === "unavailable") return <WorkspaceDataUnavailable />;
    if (overview.status === "empty") return <WorkspacePayments workspaceId={workspaceId} initialData={null} initialLoadStatus="empty" />;
  }
  const result = await loadLatestReconciliationRun(workspaceId);
  return <WorkspacePayments workspaceId={workspaceId} initialData={result.status === "ready" ? result.data : null} initialLoadStatus={result.status} />;
}
