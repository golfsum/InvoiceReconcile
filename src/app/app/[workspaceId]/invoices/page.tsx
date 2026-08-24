import { WorkspaceInvoices } from "@/components/app/workspace-data";
import { LargeInvoiceTable } from "@/components/app/records-table";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { loadLatestReconciliationOverview, loadLatestReconciliationPage } from "@/lib/reconciliation/large-run";
import type { Invoice } from "@/lib/reconciliation";

export default async function InvoicesPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (workspaceId !== "demo") {
    const overview = await loadLatestReconciliationOverview(workspaceId);
    if (overview.status === "ready") {
      const page = await loadLatestReconciliationPage<Invoice>({ workspaceId, itemType: "invoice", offset: 0, limit: 50 });
      if (page.status === "ready") return <LargeInvoiceTable workspaceId={workspaceId} initialPage={page.data} />;
      return <WorkspaceDataUnavailable />;
    }
    if (overview.status === "unavailable") return <WorkspaceDataUnavailable />;
    if (overview.status === "empty") return <WorkspaceInvoices workspaceId={workspaceId} initialData={null} initialLoadStatus="empty" />;
  }
  const result = await loadLatestReconciliationRun(workspaceId);
  return <WorkspaceInvoices workspaceId={workspaceId} initialData={result.status === "ready" ? result.data : null} initialLoadStatus={result.status} />;
}
