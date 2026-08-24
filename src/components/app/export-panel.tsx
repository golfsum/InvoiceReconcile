"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";
import type { WorkspaceDecision } from "@/lib/reconciliation/workspace-data";
import { Button } from "@/components/ui/button";
import { buildReconciliationExportRows } from "@/lib/exports/reconciliation";
import { quoteCsvCell, safeSpreadsheetRows } from "@/lib/exports/spreadsheet";

function csvBlob(rows: unknown[][]) {
  const body = rows.map((row) => row.map(quoteCsvCell).join(",")).join("\r\n");
  return new Blob([body], { type: "text/csv;charset=utf-8" });
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function xlsxBlob(rows: unknown[][]) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "InvoiceReconcile";
  const worksheet = workbook.addWorksheet("Reconciliation");
  worksheet.addRows(safeSpreadsheetRows(rows));
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.columns.forEach((column) => { column.width = 20; });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

type ExportType = "reconciled" | "unmatched" | "discrepancy" | "audit";
type ExportFileType = "csv" | "xlsx";
const EMPTY_DECISIONS: Record<string, WorkspaceDecision> = {};

export function ExportPanel({ workspaceId, runRecordId, persistenceStatus, matches, invoices, payments, decisions = EMPTY_DECISIONS, workspaceName = "workspace" }: { workspaceId: string; runRecordId?: string; persistenceStatus?: "durable" | "local"; matches: ProposedMatch[]; invoices: Invoice[]; payments: Payment[]; decisions?: Record<string, WorkspaceDecision>; workspaceName?: string }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const safeName = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  const exports = useMemo(() => {
    const exportRows = (items: ProposedMatch[]) => buildReconciliationExportRows({ matches: items, invoices, payments, decisions });
    return [
      { key: "reconciled-payments", exportType: "reconciled" as const, title: "Confirmed applications", copy: "Only payment applications a workspace member explicitly confirmed, with the selected invoices and audit decision time.", rows: exportRows(matches.filter((match) => decisions[match.id]?.outcome === "confirmed")) },
      { key: "unmatched-payments", exportType: "unmatched" as const, title: "Unmatched payments", copy: "Payments left unmatched, rejected suggestions, and unresolved engine results with no responsible invoice candidate.", rows: exportRows(matches.filter((match) => decisions[match.id]?.outcome === "unmatched" || decisions[match.id]?.outcome === "rejected" || (!decisions[match.id] && match.confidence === "unmatched"))) },
      { key: "discrepancies", exportType: "discrepancy" as const, title: "Discrepancy report", copy: "Partial applications, recorded fee differences, overpayments, duplicates, and ambiguous candidates.", rows: exportRows(matches.filter((match) => match.discrepancyMinor !== 0 || match.confidence === "review" || Boolean(decisions[match.id]?.feeMinor))) },
      { key: "reconciliation-detail", exportType: "audit" as const, title: "Current reconciliation detail", copy: "Payment, invoice, evidence, and saved decision fields from the current reconciliation run. Immutable action history remains in Reconciliation history.", rows: exportRows(matches) },
    ];
  }, [decisions, invoices, matches, payments]);

  async function recordExport(exportType: ExportType, fileType: ExportFileType, rowCount: number) {
    if (workspaceId === "demo" || persistenceStatus === "local") return;
    if (persistenceStatus !== "durable" || !runRecordId) throw new Error("This saved run is unavailable for an audited export.");
    const response = await fetch("/api/reconciliation/exports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, runRecordId, exportType, fileType, rowCount, idempotencyKey: crypto.randomUUID() }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "The export could not be recorded, so no file was downloaded.");
  }

  async function runExport(item: typeof exports[number], fileType: ExportFileType) {
    const operation = `${item.key}:${fileType}`;
    setExporting(operation);
    try {
      const blob = fileType === "csv" ? csvBlob(item.rows) : await xlsxBlob(item.rows);
      await recordExport(item.exportType, fileType, Math.max(0, item.rows.length - 1));
      downloadBlob(`${safeName}-${item.key}.${fileType}`, blob);
      toast.success(`${item.title} ${fileType.toUpperCase()} downloaded`, { description: persistenceStatus === "durable" ? "Recorded in the workspace audit log." : "Created from the records on this device." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The export could not be created.");
    } finally {
      setExporting(null);
    }
  }

  return <div className="mx-auto max-w-5xl"><div><p className="eyebrow">Export</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Download reconciliation records</h1><p className="mt-2 text-sm text-muted">Exports never write back to an accounting system. Review the result before importing it elsewhere.</p></div><div className="mt-6 grid gap-4 md:grid-cols-2">{exports.map((item) => <section key={item.title} className="border bg-surface p-5"><div className="flex items-start justify-between gap-4"><FileSpreadsheet className="size-5 text-brand" /><span className="numeric text-xs font-semibold text-muted">{Math.max(0, item.rows.length - 1)} rows</span></div><h2 className="mt-6 font-semibold">{item.title}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-muted">{item.copy}</p><div className="mt-5 flex flex-wrap gap-2"><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void runExport(item, "csv")}>{exporting === `${item.key}:csv` ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} CSV</Button><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void runExport(item, "xlsx")}>{exporting === `${item.key}:xlsx` ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} XLSX</Button></div></section>)}</div><div className="mt-5 flex gap-3 border border-info/25 bg-info-soft p-4 text-sm text-info"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Exports use only the reconciliation records loaded in this workspace and do not send financial values to analytics. Downloads from saved runs are recorded in the audit log.</p></div></div>;
}

export function LargeExportPanel({ workspaceId, runRecordId, matchCount }: { workspaceId: string; runRecordId: string; matchCount: number }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const exports = [
    { key: "reconciled" as const, title: "Confirmed applications", copy: "Only applications explicitly confirmed by a workspace member." },
    { key: "unmatched" as const, title: "Unmatched payments", copy: "Unmatched, rejected, and unresolved payment results." },
    { key: "discrepancy" as const, title: "Discrepancy report", copy: "Differences, review items, and recorded fee or deduction decisions." },
    { key: "audit" as const, title: "Current reconciliation detail", copy: "The complete current run with related payment, invoice, evidence, and decision fields." },
  ];

  async function download(exportType: typeof exports[number]["key"], fileType: ExportFileType) {
    const operation = `${exportType}:${fileType}`;
    setExporting(operation);
    try {
      const response = await fetch("/api/reconciliation/exports/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, runRecordId, exportType, fileType, idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "The saved-run export could not be created.");
      }
      downloadBlob(`invoice-reconcile-${exportType}.${fileType}`, await response.blob());
      toast.success(`${fileType.toUpperCase()} export downloaded`, { description: "The server paged through the saved run and recorded the download in the audit log." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The saved-run export could not be created.");
    } finally {
      setExporting(null);
    }
  }

  return <div className="mx-auto max-w-5xl"><div><p className="eyebrow">Export</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Download reconciliation records</h1><p className="mt-2 text-sm text-muted">Large saved runs are paged securely on the server when you request a file. The page itself never loads all {matchCount} results.</p></div><div className="mt-6 grid gap-4 md:grid-cols-2">{exports.map((item) => <section key={item.key} className="border bg-surface p-5"><div className="flex items-start justify-between gap-4"><FileSpreadsheet className="size-5 text-brand" /><span className="text-xs font-semibold text-muted">Server-generated</span></div><h2 className="mt-6 font-semibold">{item.title}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-muted">{item.copy}</p><div className="mt-5 flex flex-wrap gap-2"><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void download(item.key, "csv")}>{exporting === `${item.key}:csv` ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} CSV</Button><Button variant="secondary" disabled={Boolean(exporting)} onClick={() => void download(item.key, "xlsx")}>{exporting === `${item.key}:xlsx` ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />} XLSX</Button></div></section>)}</div><div className="mt-5 flex gap-3 border border-info/25 bg-info-soft p-4 text-sm text-info"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><p>Exports are assembled from bounded, authorized pages of the current saved run. Financial values are not sent to analytics.</p></div></div>;
}
