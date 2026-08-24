import type { Invoice, Payment, ReconciliationResult } from "./types";
import type { InvoiceAllocation } from "./allocations";

export const RECONCILIATION_ENGINE_VERSION = "deterministic-rules-v1";

export type WorkspaceDataPersistence = {
  status: "durable" | "local";
  runRecordId?: string;
  savedAt?: string;
  reason?: "demo" | "not_configured" | "not_authenticated" | "temporarily_unavailable";
};

export type WorkspaceDecision = {
  matchId: string;
  outcome: "confirmed" | "rejected" | "unmatched";
  invoiceIds: string[];
  allocations?: InvoiceAllocation[];
  note?: string;
  feeMinor?: number;
  appliedAmountMinor?: number;
  feedback?: "correct" | "incorrect";
  decidedAt: string;
};

export type WorkspaceSourceFile = {
  name: string;
  rows: number;
  accepted: number;
  rejected: number;
};

export type ReconciliationRunContext = {
  defaultCurrency: string;
  earlyPaymentAllowanceDays: number;
  dateWindowDays: number;
  payerMappingFingerprint?: string;
  matchingRuleFingerprint?: string;
};

export type StoredWorkspaceData = {
  runId: string;
  completedAt?: string;
  invoices: Invoice[];
  payments: Payment[];
  /** Payments first imported by this run. Carried unresolved payments are not billed twice. */
  usagePaymentCount?: number;
  result: ReconciliationResult;
  importSummary?: Record<string, number>;
  sourceFiles?: { invoice: WorkspaceSourceFile; payment: WorkspaceSourceFile };
  reconciliationContext?: ReconciliationRunContext;
  decisions?: Record<string, WorkspaceDecision>;
  persistence?: WorkspaceDataPersistence;
};

export function workspaceStorageKey(workspaceId: string) {
  return `ir_reconciliation_${workspaceId}_v1`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isStoredWorkspaceData(value: unknown): value is StoredWorkspaceData {
  if (!isRecord(value) || typeof value.runId !== "string") return false;
  if (!Array.isArray(value.invoices) || !Array.isArray(value.payments)) return false;
  if (value.usagePaymentCount !== undefined
      && (typeof value.usagePaymentCount !== "number"
        || !Number.isInteger(value.usagePaymentCount)
        || value.usagePaymentCount < 0
        || value.usagePaymentCount > value.payments.length)) return false;
  if (!isRecord(value.result) || !Array.isArray(value.result.matches)) return false;
  if (value.completedAt !== undefined && typeof value.completedAt !== "string") return false;
  if (value.reconciliationContext !== undefined) {
    if (!isRecord(value.reconciliationContext)) return false;
    const context = value.reconciliationContext;
    if (typeof context.defaultCurrency !== "string" || !/^[A-Z]{3}$/.test(context.defaultCurrency)
        || typeof context.earlyPaymentAllowanceDays !== "number"
        || !Number.isInteger(context.earlyPaymentAllowanceDays)
        || context.earlyPaymentAllowanceDays < 0
        || context.earlyPaymentAllowanceDays > 365
        || typeof context.dateWindowDays !== "number"
        || !Number.isInteger(context.dateWindowDays)
        || context.dateWindowDays < 1
        || context.dateWindowDays > 365
        || (context.payerMappingFingerprint !== undefined
          && (typeof context.payerMappingFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(context.payerMappingFingerprint)))
        || (context.matchingRuleFingerprint !== undefined
          && (typeof context.matchingRuleFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(context.matchingRuleFingerprint)))) return false;
  }
  return true;
}

function dataTimestamp(value: StoredWorkspaceData) {
  const timestamp = value.persistence?.savedAt || value.completedAt;
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newestWorkspaceData(
  local: StoredWorkspaceData | null,
  durable: StoredWorkspaceData | null,
) {
  if (!local) return durable;
  if (!durable) return local;
  return dataTimestamp(durable) >= dataTimestamp(local) ? durable : local;
}
