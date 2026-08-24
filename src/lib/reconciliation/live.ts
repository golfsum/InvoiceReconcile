import "server-only";

import { cache } from "react";
import { demoWorkspace } from "@/lib/demo/workspace";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  isStoredWorkspaceData,
  type StoredWorkspaceData,
  type WorkspaceDecision,
} from "./workspace-data";
import type { InvoiceAllocation } from "./allocations";

export type ReconciliationLoadResult =
  | { status: "ready"; data: StoredWorkspaceData }
  | { status: "empty" }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAllocations(value: unknown): InvoiceAllocation[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) return null;
  const seen = new Set<string>();
  const allocations: InvoiceAllocation[] = [];
  for (const item of value) {
    if (!isRecord(item)
        || typeof item.invoiceId !== "string"
        || !item.invoiceId
        || seen.has(item.invoiceId)
        || typeof item.amountMinor !== "number"
        || !Number.isSafeInteger(item.amountMinor)
        || item.amountMinor <= 0) return null;
    seen.add(item.invoiceId);
    allocations.push({ invoiceId: item.invoiceId, amountMinor: item.amountMinor });
  }
  return allocations;
}

function parseDecision(value: unknown): WorkspaceDecision | null {
  if (!isRecord(value)) return null;
  if (typeof value.matchId !== "string" || !["confirmed", "rejected", "unmatched"].includes(String(value.outcome))) return null;
  if (!Array.isArray(value.invoiceIds) || !value.invoiceIds.every((item) => typeof item === "string")) return null;
  if (typeof value.decidedAt !== "string") return null;
  const allocations = parseAllocations(value.allocations);
  if (allocations === null) return null;
  const appliedAmountMinor = typeof value.appliedAmountMinor === "number" ? value.appliedAmountMinor : undefined;
  if (appliedAmountMinor !== undefined && (!Number.isSafeInteger(appliedAmountMinor) || appliedAmountMinor < 0)) return null;
  if (allocations) {
    if ((value.outcome === "confirmed") !== (allocations.length > 0)) return null;
    const allocationTotal = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
    if (!Number.isSafeInteger(allocationTotal)
        || allocationTotal !== appliedAmountMinor
        || allocations.map((allocation) => allocation.invoiceId).join("\u0000") !== value.invoiceIds.join("\u0000")) return null;
  }
  return {
    matchId: value.matchId,
    outcome: value.outcome as WorkspaceDecision["outcome"],
    invoiceIds: value.invoiceIds,
    allocations,
    note: typeof value.note === "string" ? value.note : undefined,
    feeMinor: typeof value.feeMinor === "number" ? value.feeMinor : undefined,
    appliedAmountMinor,
    feedback: value.feedback === "correct" || value.feedback === "incorrect" ? value.feedback : undefined,
    decidedAt: value.decidedAt,
  };
}

export const loadLatestReconciliationRun = cache(async (workspaceId: string): Promise<ReconciliationLoadResult> => {
  if (workspaceId === "demo") {
    return { status: "ready", data: {
      runId: "fictional-demo",
      invoices: demoWorkspace.invoices,
      payments: demoWorkspace.payments,
      result: demoWorkspace.result,
      sourceFiles: {
        invoice: { name: "northstar-invoices.csv", rows: 30, accepted: 30, rejected: 0 },
        payment: { name: "northstar-payments.csv", rows: 22, accepted: 22, rejected: 0 },
      },
      decisions: {},
      persistence: { status: "local", reason: "demo" },
    } };
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: "unavailable" };
  const { data: run, error: runError } = await supabase.rpc("get_latest_reconciliation_run", {
    p_workspace_id: workspaceId,
  });
  if (runError) {
    logServerError(runError, { operation: "load_latest_reconciliation_run", code: runError.code });
    return { status: "unavailable" };
  }
  if (!isRecord(run) || typeof run.status !== "string") return { status: "unavailable" };
  if (run.status === "empty") return { status: "empty" };
  if (run.status !== "ready"
      || typeof run.run_record_id !== "string"
      || typeof run.run_key !== "string"
      || typeof run.completed_at !== "string"
      || !isStoredWorkspaceData(run.snapshot)
      || !isRecord(run.decisions)
      || !isRecord(run.invoice_states)) return { status: "unavailable" };

  const decisions: Record<string, WorkspaceDecision> = {};
  for (const [matchId, value] of Object.entries(run.decisions)) {
    const decision = parseDecision(value);
    if (!decision || decision.matchId !== matchId) return { status: "unavailable" };
    decisions[decision.matchId] = decision;
  }

  const invoices: StoredWorkspaceData["invoices"] = [];
  for (const invoice of run.snapshot.invoices) {
    const state = run.invoice_states[invoice.id];
    if (!isRecord(state)) return { status: "unavailable" };
    const outstandingAmountMinor = state.outstandingAmountMinor;
    const status = state.status;
    if (typeof outstandingAmountMinor !== "number"
        || !Number.isSafeInteger(outstandingAmountMinor)
        || outstandingAmountMinor < 0
        || outstandingAmountMinor > invoice.originalAmountMinor
        || !["open", "partially_paid", "paid", "void"].includes(String(status))) return { status: "unavailable" };
    invoices.push({
      ...invoice,
      outstandingAmountMinor,
      status: status as typeof invoice.status,
    });
  }

  return { status: "ready", data: {
    ...run.snapshot,
    runId: run.run_key,
    invoices,
    decisions,
    persistence: {
      status: "durable",
      runRecordId: run.run_record_id,
      savedAt: run.completed_at,
    },
  } };
});
