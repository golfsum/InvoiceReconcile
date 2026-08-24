import "server-only";

import { cache } from "react";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Invoice, Payment, ProposedMatch } from "./types";
import type { WorkspaceDecision, WorkspaceSourceFile } from "./workspace-data";

export type LargeRunOverview = {
  runRecordId: string;
  runKey: string;
  completedAt: string;
  currency: string;
  metrics: {
    invoices: number;
    payments: number;
    matches: number;
    confirmed: number;
    suggested: number;
    review: number;
    unmatched: number;
    exceptions: number;
    openInvoiceBalanceMinor: number;
  };
  preview: Array<{ match: ProposedMatch; payment: Payment | null }>;
  sourceFiles?: { invoice: WorkspaceSourceFile; payment: WorkspaceSourceFile };
};

export type LargeRunPage<T> = {
  runRecordId: string;
  runKey: string;
  completedAt: string;
  itemType: "invoice" | "payment" | "match";
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: T[];
  relatedInvoices: Invoice[];
  relatedPayments: Payment[];
  decisions: Record<string, WorkspaceDecision>;
};

export type LargeRunLoadResult<T> =
  | { status: "ready"; data: T }
  | { status: "empty" }
  | { status: "legacy" }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeCount(value: unknown, maximum = 100_000) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function parseOverview(value: unknown): LargeRunLoadResult<LargeRunOverview> {
  if (!isRecord(value) || typeof value.status !== "string") return { status: "unavailable" };
  if (value.status === "empty") return { status: "empty" };
  if (value.status !== "ready") return { status: "unavailable" };
  if (value.read_model === false) return { status: "legacy" };
  if (value.read_model !== true
      || typeof value.run_record_id !== "string"
      || typeof value.run_key !== "string"
      || typeof value.completed_at !== "string"
      || typeof value.currency !== "string"
      || !/^[A-Z]{3}$/.test(value.currency)
      || !isRecord(value.metrics)
      || !Array.isArray(value.preview)
      || value.preview.length > 4) return { status: "unavailable" };
  const metrics = value.metrics;
  const metricKeys = ["invoices", "payments", "matches", "confirmed", "suggested", "review", "unmatched", "exceptions"] as const;
  const parsedMetrics = Object.fromEntries(metricKeys.map((key) => [key, safeCount(metrics[key])])) as Record<(typeof metricKeys)[number], number | null>;
  const balance = safeCount(metrics.openInvoiceBalanceMinor, Number.MAX_SAFE_INTEGER);
  if (metricKeys.some((key) => parsedMetrics[key] === null) || balance === null) return { status: "unavailable" };
  const preview = value.preview.flatMap((item): LargeRunOverview["preview"] => {
    if (!isRecord(item) || !isRecord(item.match) || (item.payment !== null && !isRecord(item.payment))) return [];
    return [{ match: item.match as unknown as ProposedMatch, payment: item.payment as unknown as Payment | null }];
  });
  if (preview.length !== value.preview.length) return { status: "unavailable" };
  const sourceFiles = isRecord(value.source_files)
      && isRecord(value.source_files.invoice)
      && isRecord(value.source_files.payment)
    ? value.source_files as unknown as LargeRunOverview["sourceFiles"]
    : undefined;
  return { status: "ready", data: {
    runRecordId: value.run_record_id,
    runKey: value.run_key,
    completedAt: value.completed_at,
    currency: value.currency,
    metrics: {
      invoices: parsedMetrics.invoices!,
      payments: parsedMetrics.payments!,
      matches: parsedMetrics.matches!,
      confirmed: parsedMetrics.confirmed!,
      suggested: parsedMetrics.suggested!,
      review: parsedMetrics.review!,
      unmatched: parsedMetrics.unmatched!,
      exceptions: parsedMetrics.exceptions!,
      openInvoiceBalanceMinor: balance,
    },
    preview,
    sourceFiles,
  } };
}

function parsePage<T>(value: unknown, requestedType: LargeRunPage<T>["itemType"], requestedLimit: number): LargeRunLoadResult<LargeRunPage<T>> {
  if (!isRecord(value) || typeof value.status !== "string") return { status: "unavailable" };
  if (value.status === "empty") return { status: "empty" };
  if (value.status === "legacy") return { status: "legacy" };
  if (value.status !== "ready"
      || value.item_type !== requestedType
      || typeof value.run_record_id !== "string"
      || typeof value.run_key !== "string"
      || typeof value.completed_at !== "string"
      || !Array.isArray(value.items)
      || value.items.length > requestedLimit
      || !Array.isArray(value.related_invoices)
      || value.related_invoices.length > 1_000
      || !Array.isArray(value.related_payments)
      || value.related_payments.length > 1_000
      || !isRecord(value.decisions)) return { status: "unavailable" };
  const offset = safeCount(value.offset);
  const limit = safeCount(value.limit, 100);
  const total = safeCount(value.total);
  if (offset === null || limit === null || limit < 1 || total === null || typeof value.has_more !== "boolean") return { status: "unavailable" };
  return { status: "ready", data: {
    runRecordId: value.run_record_id,
    runKey: value.run_key,
    completedAt: value.completed_at,
    itemType: requestedType,
    offset,
    limit,
    total,
    hasMore: value.has_more,
    items: value.items as T[],
    relatedInvoices: value.related_invoices as Invoice[],
    relatedPayments: value.related_payments as Payment[],
    decisions: value.decisions as Record<string, WorkspaceDecision>,
  } };
}

export const loadLatestReconciliationOverview = cache(async (workspaceId: string): Promise<LargeRunLoadResult<LargeRunOverview>> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: "unavailable" };
  const { data, error } = await supabase.rpc("get_latest_reconciliation_run_overview", { p_workspace_id: workspaceId });
  if (error) {
    logServerError(error, { operation: "load_large_run_overview", code: error.code });
    return { status: "unavailable" };
  }
  return parseOverview(data);
});

export async function loadLatestReconciliationPage<T>(options: {
  workspaceId: string;
  itemType: LargeRunPage<T>["itemType"];
  offset: number;
  limit: number;
  search?: string;
  status?: string;
}): Promise<LargeRunLoadResult<LargeRunPage<T>>> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: "unavailable" };
  const { data, error } = await supabase.rpc("get_latest_reconciliation_run_items", {
    p_workspace_id: options.workspaceId,
    p_item_type: options.itemType,
    p_offset: options.offset,
    p_limit: options.limit,
    p_search: options.search || "",
    p_status: options.status || "all",
  });
  if (error) {
    logServerError(error, { operation: "load_large_run_page", code: error.code });
    return { status: "unavailable" };
  }
  return parsePage<T>(data, options.itemType, options.limit);
}
