import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReconciliationExportRows } from "@/lib/exports/reconciliation";
import { quoteCsvCell, safeSpreadsheetRows } from "@/lib/exports/spreadsheet";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";
import type { WorkspaceDecision } from "@/lib/reconciliation/workspace-data";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  runRecordId: z.string().uuid(),
  exportType: z.enum(["reconciled", "unmatched", "discrepancy", "audit"]),
  fileType: z.enum(["csv", "xlsx"]),
  idempotencyKey: z.string().uuid(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function includeMatch(match: ProposedMatch, decision: WorkspaceDecision | undefined, type: z.infer<typeof requestSchema>["exportType"]) {
  if (type === "audit") return true;
  if (type === "reconciled") return decision?.outcome === "confirmed";
  if (type === "unmatched") return decision?.outcome === "unmatched" || decision?.outcome === "rejected" || (!decision && match.confidence === "unmatched");
  return match.discrepancyMinor !== 0 || match.confidence === "review" || Boolean(decision?.feeMinor);
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "large-run-export"), prefix: "large-run-export", limit: 10, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Secure export authorization is temporarily unavailable." : "Too many exports were requested. Wait a few minutes and try again." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid saved-run export." }, { status: 400, headers: rateLimitHeaders(limit) });
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Saved-run exports are not configured." }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Sign in to export this saved run." }, { status: 401, headers: rateLimitHeaders(limit) });

  const rows: unknown[][] = [];
  let offset = 0;
  let total = 0;
  do {
    const { data, error } = await supabase.rpc("get_latest_reconciliation_run_items", {
      p_workspace_id: parsed.data.workspaceId,
      p_item_type: "match",
      p_offset: offset,
      p_limit: 100,
      p_search: "",
      p_status: "all",
    });
    if (error || !isRecord(data)
        || data.status !== "ready"
        || data.run_record_id !== parsed.data.runRecordId
        || !Array.isArray(data.items) || data.items.length > 100
        || !Array.isArray(data.related_invoices) || data.related_invoices.length > 2_000
        || !Array.isArray(data.related_payments) || data.related_payments.length > 1_000
        || !isRecord(data.decisions)
        || typeof data.total !== "number" || !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 50_000) {
      if (error) logServerError(error, { operation: "large_run_export_page", code: error.code });
      return NextResponse.json({ error: "The saved run changed or an export page was unavailable. Start the export again." }, { status: error?.code === "42501" ? 403 : 409, headers: rateLimitHeaders(limit) });
    }
    total = data.total;
    const decisions = data.decisions as Record<string, WorkspaceDecision>;
    const matches = (data.items as ProposedMatch[]).filter((match) => includeMatch(match, decisions[match.id], parsed.data.exportType));
    const pageRows = buildReconciliationExportRows({
      matches,
      invoices: data.related_invoices as Invoice[],
      payments: data.related_payments as Payment[],
      decisions,
    });
    if (offset === 0) rows.push(...pageRows);
    else rows.push(...pageRows.slice(1));
    offset += data.items.length;
    if (data.items.length === 0 && offset < total) {
      return NextResponse.json({ error: "The saved run export did not advance safely." }, { status: 503, headers: rateLimitHeaders(limit) });
    }
  } while (offset < total);

  const rowCount = Math.max(0, rows.length - 1);
  const { error: auditError } = await supabase.rpc("record_reconciliation_export", {
    p_workspace_id: parsed.data.workspaceId,
    p_run_record_id: parsed.data.runRecordId,
    p_export_type: parsed.data.exportType,
    p_file_type: parsed.data.fileType,
    p_row_count: rowCount,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (auditError) {
    logServerError(auditError, { operation: "record_large_run_export", code: auditError.code });
    return NextResponse.json({ error: "The export audit record could not be confirmed, so no file was downloaded." }, { status: auditError.code === "42501" ? 403 : 503, headers: rateLimitHeaders(limit) });
  }

  let body: BodyInit;
  let contentType: string;
  if (parsed.data.fileType === "csv") {
    body = rows.map((row) => row.map(quoteCsvCell).join(",")).join("\r\n");
    contentType = "text/csv;charset=utf-8";
  } else {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "InvoiceReconcile";
    const worksheet = workbook.addWorksheet("Reconciliation");
    worksheet.addRows(safeSpreadsheetRows(rows));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.columns.forEach((column) => { column.width = 20; });
    const output = await workbook.xlsx.writeBuffer();
    body = new Uint8Array(output);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return new Response(body, {
    headers: {
      ...rateLimitHeaders(limit),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="invoice-reconcile-${parsed.data.exportType}.${parsed.data.fileType}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
