"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { demoWorkspace } from "@/lib/demo/workspace";
import { ReviewQueue } from "@/components/app/review-queue";
import { InvoiceTable, PaymentTable } from "@/components/app/records-table";
import { ExportPanel } from "@/components/app/export-panel";
import { PriorWorkflowSurvey } from "@/components/app/workflow-survey";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import {
  isStoredWorkspaceData,
  newestWorkspaceData,
  workspaceStorageKey,
  type StoredWorkspaceData,
} from "@/lib/reconciliation/workspace-data";

function readWorkspace(workspaceId: string): StoredWorkspaceData | null {
  try {
    const key = workspaceStorageKey(workspaceId);
    const raw = workspaceId === "demo" ? window.localStorage.getItem(key) : window.sessionStorage.getItem(key);
    if (workspaceId !== "demo") window.localStorage.removeItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredWorkspaceData(parsed) ? parsed : null;
  } catch { return null; }
}

function demoData(): StoredWorkspaceData {
  return { runId: "fictional-demo", invoices: demoWorkspace.invoices, payments: demoWorkspace.payments, result: demoWorkspace.result, persistence: { status: "local", reason: "demo" } };
}

type WorkspaceLoadStatus = "ready" | "empty" | "unavailable";

type WorkspaceDataProps = {
  workspaceId: string;
  initialData?: StoredWorkspaceData | null;
  initialLoadStatus?: WorkspaceLoadStatus;
};

function useWorkspaceData(workspaceId: string, initialData?: StoredWorkspaceData | null, initialLoadStatus?: WorkspaceLoadStatus) {
  const [data, setData] = useState<StoredWorkspaceData | null>(() => initialData || (workspaceId === "demo" ? demoData() : null));
  const [status, setStatus] = useState<WorkspaceLoadStatus>(() => initialData || workspaceId === "demo" ? "ready" : initialLoadStatus || "empty");
  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        const local = readWorkspace(workspaceId);
        const starting = workspaceId === "demo" ? newestWorkspaceData(local, initialData || null) : initialData || local;
        if (starting) {
          setData(starting);
          setStatus("ready");
        }
        if (workspaceId !== "demo" && initialData?.persistence?.status === "durable") window.sessionStorage.removeItem(workspaceStorageKey(workspaceId));
        if (workspaceId === "demo") return;
        try {
          const response = await fetch(`/api/reconciliation/runs/latest?workspaceId=${encodeURIComponent(workspaceId)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) {
            if (!starting) setStatus(response.status === 404 ? "empty" : "unavailable");
            return;
          }
          const durable: unknown = await response.json();
          if (!isStoredWorkspaceData(durable)) {
            if (!starting) setStatus("unavailable");
            return;
          }
          setData(durable);
          setStatus("ready");
          window.sessionStorage.removeItem(workspaceStorageKey(workspaceId));
        } catch {
          if (!controller.signal.aborted && !starting) setStatus("unavailable");
        }
      })();
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
    };
  }, [initialData, initialLoadStatus, workspaceId]);
  return { data, status };
}

function EmptyWorkspaceData({ workspaceId }: { workspaceId: string }) {
  return <div className="mx-auto max-w-3xl border bg-surface p-8 text-center"><h1 className="text-2xl font-semibold">No reconciliation run yet</h1><p className="mt-2 text-sm text-muted">Import open invoices and incoming payments to create this workspace&apos;s first review queue.</p><Link className="mt-5 inline-flex text-sm font-semibold text-brand hover:underline" href={`/app/${workspaceId}/imports`}>Start an import</Link></div>;
}

function WorkspaceDataFallback({ workspaceId, status }: { workspaceId: string; status: WorkspaceLoadStatus }) {
  return status === "unavailable" ? <WorkspaceDataUnavailable /> : <EmptyWorkspaceData workspaceId={workspaceId} />;
}

export function WorkspaceReview({ workspaceId, initialData, initialLoadStatus }: WorkspaceDataProps) { const { data, status } = useWorkspaceData(workspaceId, initialData, initialLoadStatus); return data ? <><ReviewQueue workspaceId={workspaceId} runRecordId={data.persistence?.runRecordId} persistenceStatus={data.persistence?.status} initialDecisions={data.decisions} matches={data.result.matches} invoices={data.invoices} payments={data.payments} />{data.runId !== "fictional-demo" ? <PriorWorkflowSurvey workspaceId={workspaceId} /> : null}</> : <WorkspaceDataFallback workspaceId={workspaceId} status={status} />; }
export function WorkspaceInvoices({ workspaceId, initialData, initialLoadStatus }: WorkspaceDataProps) { const { data, status } = useWorkspaceData(workspaceId, initialData, initialLoadStatus); return data ? <InvoiceTable invoices={data.invoices} /> : <WorkspaceDataFallback workspaceId={workspaceId} status={status} />; }
export function WorkspacePayments({ workspaceId, initialData, initialLoadStatus }: WorkspaceDataProps) { const { data, status } = useWorkspaceData(workspaceId, initialData, initialLoadStatus); return data ? <PaymentTable payments={data.payments} /> : <WorkspaceDataFallback workspaceId={workspaceId} status={status} />; }
export function WorkspaceExports({ workspaceId, initialData, initialLoadStatus }: WorkspaceDataProps) { const { data, status } = useWorkspaceData(workspaceId, initialData, initialLoadStatus); return data ? <ExportPanel workspaceId={workspaceId} runRecordId={data.persistence?.runRecordId} persistenceStatus={data.persistence?.status} decisions={data.decisions} matches={data.result.matches} invoices={data.invoices} payments={data.payments} workspaceName={workspaceId === "demo" && data.runId === "fictional-demo" ? "northstar" : workspaceId} /> : <WorkspaceDataFallback workspaceId={workspaceId} status={status} />; }
