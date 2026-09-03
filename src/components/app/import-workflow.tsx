"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, FileSpreadsheet, LoaderCircle, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { isStoredWorkspaceData, workspaceStorageKey } from "@/lib/reconciliation/workspace-data";
import { cn } from "@/lib/utils";
import { sendVercelAnalyticsEvent } from "@/lib/analytics/client";

type ImportKind = "invoice" | "payment";
type Preview = {
  file: { name: string; size: number; fingerprint: string };
  kind: ImportKind;
  headers: string[];
  rowCount: number;
  preview: Record<string, unknown>[];
  suggestions: { field: string; header: string; confidence: "exact" | "likely" }[];
  mapping: Record<string, string>;
  mappingSource?: "saved" | "detected";
  issues: { message: string; row?: number }[];
  sheets: string[];
  selectedSheet?: string;
};

type DurableRunReceipt = {
  runId: string;
  persistence: { status: "durable"; runRecordId: string; savedAt: string };
  counts: { invoices: number; payments: number; matches: number; review: number; issues: number };
};

type AsyncProgress = { current: number; total: number; label: string };
type AsyncSourceStatus = {
  sourceId: string;
  kind: ImportKind;
  sourceType: "csv" | "xlsx";
  byteSize: number;
  status: "awaiting_upload" | "preview_queued" | "preview_processing" | "preview_ready" | "reconciling" | "completed" | "failed" | "cancelled" | "expired";
  selectedSheet?: string;
  sheets: string[];
  headers: string[];
  rowCount?: number;
  mapping: Record<string, string>;
  mappingSource?: "saved" | "detected";
  issues: { code: string; row?: number }[];
  progress: AsyncProgress;
  error?: { code: string; message: string } | null;
};

type AsyncReconciliationStatus = {
  requestId: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  progress: AsyncProgress;
  counts?: DurableRunReceipt["counts"];
  error?: { code: string; message: string } | null;
};

function uuid() {
  return crypto.randomUUID();
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("The private upload did not complete. Try again."));
    });
    xhr.addEventListener("error", () => reject(new Error("The private upload connection was interrupted.")));
    xhr.addEventListener("abort", () => reject(new Error("The private upload was cancelled.")));
    const body = new FormData();
    body.append("cacheControl", "3600");
    const canonicalFile = new File([file], `source.${file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv"}`, {
      type: contentType,
      lastModified: file.lastModified,
    });
    body.append("", canonicalFile);
    xhr.send(body);
  });
}

function safeIssueMessage(code: string) {
  if (code === "invalid_csv") return "Some rows have CSV formatting issues. They remain available for validation during reconciliation.";
  return "The source contains rows that may need attention during reconciliation.";
}

function recordCountBand(count: number): "1_50" | "51_500" | "501_2500" | "2501_10000" | "10000_plus" {
  if (count <= 50) return "1_50";
  if (count <= 500) return "51_500";
  if (count <= 2_500) return "501_2500";
  if (count <= 10_000) return "2501_10000";
  return "10000_plus";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDurableRunReceipt(value: unknown): value is DurableRunReceipt {
  if (!isRecord(value) || typeof value.runId !== "string" || !isRecord(value.persistence) || !isRecord(value.counts)) return false;
  const persistence = value.persistence;
  const counts = value.counts;
  return persistence.status === "durable"
    && typeof persistence.runRecordId === "string"
    && typeof persistence.savedAt === "string"
    && ["invoices", "payments", "matches", "review", "issues"].every((key) => typeof counts[key] === "number" && Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0);
}

const labels: Record<ImportKind, { title: string; copy: string; sample: string }> = {
  invoice: { title: "Open invoices", copy: "Invoice number, customer, date, original amount, and open balance.", sample: "/sample-data/northstar-invoices.csv" },
  payment: { title: "Incoming payments", copy: "Date, amount, payer, bank memo, reference, and transaction ID.", sample: "/sample-data/northstar-payments.csv" },
};

const fields: Record<ImportKind, Array<{ key: string; label: string; required?: boolean }>> = {
  invoice: [
    { key: "invoiceNumber", label: "Invoice number", required: true }, { key: "customerName", label: "Customer name", required: true },
    { key: "invoiceDate", label: "Invoice date", required: true }, { key: "originalAmount", label: "Original amount", required: true },
    { key: "outstandingBalance", label: "Outstanding balance" }, { key: "dueDate", label: "Due date" },
    { key: "currency", label: "Currency" }, { key: "reference", label: "Reference or PO" }, { key: "memo", label: "Memo" },
  ],
  payment: [
    { key: "paymentDate", label: "Payment date", required: true }, { key: "amount", label: "Amount", required: true },
    { key: "payerName", label: "Payer name" }, { key: "description", label: "Description" },
    { key: "bankReference", label: "Bank reference" }, { key: "transactionId", label: "Transaction ID" },
    { key: "currency", label: "Currency" }, { key: "accountId", label: "Account" },
  ],
};

function hasRequiredMapping(preview: Preview) {
  return fields[preview.kind].every((field) => !field.required || Boolean(preview.mapping[field.key]));
}

export function ImportWorkflow({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [previews, setPreviews] = useState<Partial<Record<ImportKind, Preview>>>({});
  const [loading, setLoading] = useState<ImportKind | null>(null);
  const [accepted, setAccepted] = useState<ImportKind[]>([]);
  const [matching, setMatching] = useState(false);
  const [sourceIds, setSourceIds] = useState<Partial<Record<ImportKind, string>>>({});
  const [sourceProgress, setSourceProgress] = useState<Partial<Record<ImportKind, AsyncProgress>>>({});
  const [matchingProgress, setMatchingProgress] = useState<AsyncProgress | null>(null);
  const invoiceInput = useRef<HTMLInputElement>(null);
  const paymentInput = useRef<HTMLInputElement>(null);
  const reconciliationIdempotency = useRef(uuid());
  const files = useRef<Partial<Record<ImportKind, File>>>({});
  const inputRefs = { invoice: invoiceInput, payment: paymentInput };

  async function pollSource(kind: ImportKind, sourceId: string): Promise<AsyncSourceStatus> {
    for (let attempt = 0; attempt < 2_400; attempt += 1) {
      const response = await fetch(`/api/imports/sources/${encodeURIComponent(sourceId)}`, { cache: "no-store" });
      const result = await response.json() as AsyncSourceStatus & { error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Import status could not be loaded.");
      setSourceProgress((current) => ({ ...current, [kind]: result.progress }));
      if (result.status === "preview_ready") return result;
      if (result.status === "failed" || result.status === "cancelled" || result.status === "expired") {
        throw new Error(typeof result.error === "object" && result.error?.message
          ? result.error.message
          : "The source stopped safely before preview. Review the file and try again.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    throw new Error("The source is still processing. You can leave this page and return from the in-app notification or an email update if enabled.");
  }

  function applyAsyncPreview(kind: ImportKind, file: File, source: AsyncSourceStatus, autoConfirm = false) {
    const preview: Preview = {
      file: { name: file.name, size: source.byteSize, fingerprint: source.sourceId },
      kind,
      headers: source.headers,
      rowCount: source.rowCount || 0,
      preview: [],
      suggestions: [],
      mapping: source.mapping,
      mappingSource: source.mappingSource,
      issues: source.issues.map((issue) => ({ message: safeIssueMessage(issue.code), row: issue.row })),
      sheets: source.sheets,
      selectedSheet: source.selectedSheet,
    };
    const sampleReady = autoConfirm && hasRequiredMapping(preview);
    setPreviews((current) => ({ ...current, [kind]: preview }));
    setAccepted((current) => sampleReady
      ? current.includes(kind) ? current : [...current, kind]
      : current.filter((item) => item !== kind));
    toast.success(sampleReady
      ? `${labels[kind].title} sample ready`
      : `${preview.rowCount} ${kind === "invoice" ? "invoice" : "payment"} rows are ready to map`, sampleReady
      ? { description: "Required columns were detected and confirmed automatically." }
      : undefined);
  }

  async function previewLiveFile(kind: ImportKind, file: File, autoConfirm = false) {
    const lowerName = file.name.toLowerCase();
    const sourceType = lowerName.endsWith(".xlsx") ? "xlsx" : lowerName.endsWith(".csv") ? "csv" : null;
    if (!sourceType) throw new Error("Use a CSV or XLSX file for this import.");
    if (file.size === 0) throw new Error("The selected file is empty.");
    if (file.size > 50 * 1024 * 1024) throw new Error("Each private source must be 50 MB or smaller.");
    setSourceProgress((current) => ({ ...current, [kind]: { current: 2, total: 100, label: "Calculating a local integrity hash" } }));
    const sha256 = await sha256File(file);
    const initResponse = await fetch("/api/imports/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, kind, sourceType, byteSize: file.size, sha256, idempotencyKey: uuid() }),
    });
    const init = await initResponse.json() as { sourceId?: string; uploadUrl?: string; contentType?: string; error?: string };
    if (!initResponse.ok || !init.sourceId || !init.uploadUrl || !init.contentType) {
      throw new Error(init.error || "The private upload could not be authorized.");
    }
    setSourceIds((current) => ({ ...current, [kind]: init.sourceId }));
    setSourceProgress((current) => ({ ...current, [kind]: { current: 5, total: 100, label: "Uploading directly to private storage" } }));
    await uploadToSignedUrl(init.uploadUrl, file, init.contentType, (percent) => {
      setSourceProgress((current) => ({
        ...current,
        [kind]: { current: 5 + Math.round(percent * 0.65), total: 100, label: `Uploading to private storage: ${percent}%` },
      }));
    });
    setSourceProgress((current) => ({ ...current, [kind]: { current: 72, total: 100, label: "Finalizing the one-use upload" } }));
    const finalizeResponse = await fetch(`/api/imports/sources/${encodeURIComponent(init.sourceId)}/finalize`, { method: "POST" });
    const finalized = await finalizeResponse.json() as { error?: string };
    if (!finalizeResponse.ok) throw new Error(finalized.error || "The private upload could not be finalized.");
    const source = await pollSource(kind, init.sourceId);
    applyAsyncPreview(kind, file, source, autoConfirm);
  }

  async function previewFile(kind: ImportKind, file: File, sheet?: string, autoConfirm = false) {
    files.current[kind] = file;
    setLoading(kind);
    try {
      if (workspaceId !== "demo") {
        await previewLiveFile(kind, file, autoConfirm);
        return;
      }
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      body.set("workspaceId", workspaceId);
      if (sheet) body.set("sheet", sheet);
      const response = await fetch("/api/imports/preview", { method: "POST", body });
      const result = await response.json() as Preview & { error?: string };
      if (!response.ok) throw new Error(result.error || "The file could not be previewed.");
      const sampleReady = autoConfirm && hasRequiredMapping(result);
      setPreviews((current) => ({ ...current, [kind]: result }));
      setAccepted((current) => sampleReady
        ? current.includes(kind) ? current : [...current, kind]
        : current.filter((item) => item !== kind));
      toast.success(sampleReady
        ? `${labels[kind].title} sample ready`
        : `${result.rowCount} ${kind === "invoice" ? "invoice" : "payment"} rows found`, sampleReady
        ? { description: "Required columns were detected and confirmed automatically." }
        : undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be previewed.");
    } finally {
      setLoading(null);
    }
  }

  async function loadSample(kind: ImportKind) {
    setLoading(kind);
    try {
      const response = await fetch(labels[kind].sample);
      if (!response.ok) throw new Error(`The fictional sample ${kind === "invoice" ? "invoices" : "payments"} could not be loaded.`);
      const blob = await response.blob();
      await previewFile(kind, new File([blob], labels[kind].sample.split("/").pop() || `${kind}.csv`, { type: "text/csv" }), undefined, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The fictional sample could not be loaded.");
    } finally {
      setLoading(null);
    }
  }

  function updateMapping(kind: ImportKind, field: string, header: string) {
    setPreviews((current) => {
      const preview = current[kind];
      if (!preview) return current;
      const mapping = { ...preview.mapping };
      if (header) mapping[field] = header;
      else delete mapping[field];
      return { ...current, [kind]: { ...preview, mapping } };
    });
    setAccepted((current) => current.filter((item) => item !== kind));
  }

  function confirm(kind: ImportKind) {
    const preview = previews[kind];
    const missing = fields[kind].filter((field) => field.required && !preview?.mapping[field.key]);
    if (missing.length) {
      toast.error(`Choose ${missing.map((field) => field.label.toLowerCase()).join(", ")} before continuing.`);
      return;
    }
    setAccepted((current) => current.includes(kind) ? current : [...current, kind]);
    toast.success(`${labels[kind].title} import staged`, { description: workspaceId === "demo"
      ? "The original row values remain beside normalized records."
      : "The private source is ready for the durable reconciliation worker." });
  }

  async function changeSheet(kind: ImportKind, sheet: string) {
    const file = files.current[kind];
    const sourceId = sourceIds[kind];
    if (!file) return;
    if (workspaceId === "demo" || !sourceId) {
      await previewFile(kind, file, sheet);
      return;
    }
    setLoading(kind);
    setAccepted((current) => current.filter((item) => item !== kind));
    setSourceProgress((current) => ({ ...current, [kind]: { current: 10, total: 100, label: "Queued to read the selected worksheet" } }));
    try {
      const response = await fetch(`/api/imports/sources/${encodeURIComponent(sourceId)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheet }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The worksheet could not be queued.");
      applyAsyncPreview(kind, file, await pollSource(kind, sourceId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The worksheet could not be processed.");
    } finally {
      setLoading(null);
    }
  }

  async function removeSource(kind: ImportKind) {
    const sourceId = sourceIds[kind];
    if (!sourceId) {
      setPreviews((current) => ({ ...current, [kind]: undefined }));
      delete files.current[kind];
      return;
    }
    try {
      const response = await fetch(`/api/imports/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string; deletionStatus?: string; message?: string };
      if (!response.ok && result.deletionStatus !== "pending") throw new Error(result.error || "Source deletion could not be scheduled.");
      setPreviews((current) => ({ ...current, [kind]: undefined }));
      setSourceIds((current) => ({ ...current, [kind]: undefined }));
      setSourceProgress((current) => ({ ...current, [kind]: undefined }));
      setAccepted((current) => current.filter((item) => item !== kind));
      delete files.current[kind];
      toast.success("Private source deletion scheduled", { description: "Deletion will retry until storage confirms removal." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Source deletion could not be scheduled.");
    }
  }

  async function pollReconciliation(requestId: string): Promise<AsyncReconciliationStatus> {
    for (let attempt = 0; attempt < 14_400; attempt += 1) {
      const response = await fetch(`/api/reconciliation/async/${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const result = await response.json() as AsyncReconciliationStatus & { error?: string | { message?: string } };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Reconciliation status could not be loaded.");
      setMatchingProgress(result.progress);
      if (result.status === "succeeded") return result;
      if (result.status === "failed" || result.status === "cancelled") {
        throw new Error(typeof result.error === "object" && result.error?.message
          ? result.error.message
          : "The background reconciliation stopped safely before saving.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("The reconciliation is still running. You can leave this page and return from the in-app notification or an email update if enabled.");
  }

  async function runLiveReconciliation(invoicePreview: Preview, paymentPreview: Preview) {
    const invoiceSourceId = sourceIds.invoice;
    const paymentSourceId = sourceIds.payment;
    if (!invoiceSourceId || !paymentSourceId) throw new Error("Both private sources must finish uploading before reconciliation.");
    setMatchingProgress({ current: 0, total: 100, label: "Queueing durable reconciliation" });
    const response = await fetch("/api/reconciliation/async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        invoiceSourceId,
        paymentSourceId,
        invoiceMapping: invoicePreview.mapping,
        paymentMapping: paymentPreview.mapping,
        idempotencyKey: reconciliationIdempotency.current,
      }),
    });
    const queued = await response.json() as { requestId?: string; error?: string };
    if (!response.ok) throw new Error(queued.error || "The reconciliation could not be queued.");
    if (!queued.requestId) throw new Error("The reconciliation queue receipt was incomplete.");
    const completed = await pollReconciliation(queued.requestId);
    const counts = completed.counts;
    if (!counts || ![counts.invoices, counts.payments, counts.matches, counts.review, counts.issues]
      .every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("The saved reconciliation receipt was incomplete.");
    }
    const storageKey = workspaceStorageKey(workspaceId);
    window.localStorage.removeItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
    sendVercelAnalyticsEvent("invoice_imported", { rows: counts.invoices });
    sendVercelAnalyticsEvent("payment_imported", { rows: counts.payments });
    sendVercelAnalyticsEvent("reconciliation_completed", { matches: counts.matches, review: counts.review });
    sendAnalyticsEvent("invoice_imported", { import_type: "invoice", record_count_band: recordCountBand(counts.invoices) });
    sendAnalyticsEvent("payment_imported", { import_type: "payment", record_count_band: recordCountBand(counts.payments) });
    sendAnalyticsEvent("reconciliation_completed", { result: "completed", record_count_band: recordCountBand(counts.payments) });
    toast.success("Reconciliation saved", { description: `${counts.matches} payment results are ready to inspect. Private source deletion is being confirmed.` });
    reconciliationIdempotency.current = uuid();
    const decisionKey = `ir_decisions_${workspaceId}_v1`;
    window.localStorage.removeItem(decisionKey);
    window.sessionStorage.removeItem(decisionKey);
    router.push(`/app/${workspaceId}/exceptions`);
  }

  async function runReconciliation() {
    const invoiceFile = files.current.invoice;
    const paymentFile = files.current.payment;
    const invoicePreview = previews.invoice;
    const paymentPreview = previews.payment;
    if (!invoiceFile || !paymentFile || !invoicePreview || !paymentPreview || accepted.length !== 2) return;
    setMatching(true);
    if (workspaceId !== "demo") {
      try {
        await runLiveReconciliation(invoicePreview, paymentPreview);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "The reconciliation could not be completed.");
        setMatching(false);
      }
      return;
    }
    const body = new FormData();
    body.set("invoiceFile", invoiceFile);
    body.set("paymentFile", paymentFile);
    body.set("workspaceId", workspaceId);
    body.set("invoiceMapping", JSON.stringify(invoicePreview.mapping));
    body.set("paymentMapping", JSON.stringify(paymentPreview.mapping));
    if (invoicePreview.selectedSheet) body.set("invoiceSheet", invoicePreview.selectedSheet);
    if (paymentPreview.selectedSheet) body.set("paymentSheet", paymentPreview.selectedSheet);
    try {
      const response = await fetch(`/api/reconciliation/run?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", body });
      const result: unknown = await response.json();
      const errorMessage = isRecord(result) && typeof result.error === "string" ? result.error : null;
      if (!response.ok) throw new Error(errorMessage || "The reconciliation could not be completed.");
      const storageKey = workspaceStorageKey(workspaceId);
      if (workspaceId === "demo") {
        if (!isStoredWorkspaceData(result)) throw new Error("The browser-local reconciliation result was incomplete.");
        window.localStorage.setItem(storageKey, JSON.stringify(result));
        sendVercelAnalyticsEvent("invoice_imported", { rows: result.invoices.length });
        sendVercelAnalyticsEvent("payment_imported", { rows: result.payments.length });
        sendVercelAnalyticsEvent("reconciliation_completed", { matches: result.result.matches.length, review: result.result.matches.filter((match) => match.confidence === "review" || match.confidence === "unmatched").length });
        sendAnalyticsEvent("invoice_imported", { import_type: "invoice", record_count_band: recordCountBand(result.invoices.length), source: "sample" });
        sendAnalyticsEvent("payment_imported", { import_type: "payment", record_count_band: recordCountBand(result.payments.length), source: "sample" });
        sendAnalyticsEvent("reconciliation_completed", { result: "completed", record_count_band: recordCountBand(result.payments.length), source: "sample" });
        toast.warning("Demo reconciliation ready on this device", { description: `${result.result.matches.length} fictional payment results are ready to inspect.` });
      } else {
        if (!isDurableRunReceipt(result)) throw new Error("The saved reconciliation receipt was incomplete.");
        window.localStorage.removeItem(storageKey);
        window.sessionStorage.removeItem(storageKey);
        sendVercelAnalyticsEvent("invoice_imported", { rows: result.counts.invoices });
        sendVercelAnalyticsEvent("payment_imported", { rows: result.counts.payments });
        sendVercelAnalyticsEvent("reconciliation_completed", { matches: result.counts.matches, review: result.counts.review });
        sendAnalyticsEvent("invoice_imported", { import_type: "invoice", record_count_band: recordCountBand(result.counts.invoices) });
        sendAnalyticsEvent("payment_imported", { import_type: "payment", record_count_band: recordCountBand(result.counts.payments) });
        sendAnalyticsEvent("reconciliation_completed", { result: "completed", record_count_band: recordCountBand(result.counts.payments) });
        toast.success("Reconciliation saved", { description: `${result.counts.matches} payment results are ready to inspect from this workspace.` });
      }
      const decisionKey = `ir_decisions_${workspaceId}_v1`;
      window.localStorage.removeItem(decisionKey);
      window.sessionStorage.removeItem(decisionKey);
      router.push(`/app/${workspaceId}/exceptions`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The reconciliation could not be completed.");
      setMatching(false);
    }
  }

  return <div className="mx-auto max-w-6xl">
    <div><p className="eyebrow">Import</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Bring invoices and incoming payments</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{workspaceId === "demo" ? "Preview fictional source rows and correct the detected columns. Demo CSV and XLSX files up to 2 MB process in this browser session." : "Upload CSV or XLSX sources up to 50 MB directly to private storage. Validation and reconciliation continue in the background, with visible progress, in-app notifications, and email updates when enabled."}</p>{workspaceId !== "demo" ? <div className="mt-4 max-w-3xl border border-info/25 bg-info-soft p-4 text-sm leading-6 text-info"><p><span className="font-semibold">Messy spreadsheet?</span> <Link className="font-semibold underline underline-offset-2" href={`/contact?topic=import-mapping&workspaceId=${encodeURIComponent(workspaceId)}`}>Request first-file mapping help</Link>. Describe the columns and format, but do not email or attach financial files until support provides secure instructions.</p></div> : null}</div>
    <ol className="mt-6 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted" aria-label="Import progress"><li className={previews.invoice ? "text-brand" : ""}>1. Import invoices</li><li aria-hidden="true">→</li><li className={previews.payment ? "text-brand" : ""}>2. Import payments</li><li aria-hidden="true">→</li><li className={accepted.length === 2 ? "text-brand" : ""}>3. Run matching</li></ol>
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      {(["invoice", "payment"] as const).map((kind) => {
        const preview = previews[kind];
        const done = accepted.includes(kind);
        return <section key={kind} className="min-w-0 border bg-surface">
          <div className="flex items-start justify-between gap-4 border-b p-5"><div><div className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-brand" /><h2 className="font-semibold">{labels[kind].title}</h2></div><p className="mt-2 text-sm leading-6 text-muted">{labels[kind].copy}</p></div>{done ? <span className="inline-flex items-center gap-1 bg-success-soft px-2 py-1 text-xs font-bold text-success"><Check className="size-3.5" />Ready</span> : null}</div>
          {!preview ? <div className="p-5"><button type="button" className="flex min-h-44 w-full flex-col items-center justify-center border border-dashed border-border-strong bg-background p-6 text-center transition hover:border-brand hover:bg-brand-soft/40" onClick={() => inputRefs[kind].current?.click()} disabled={loading !== null}>{loading === kind ? <LoaderCircle className="size-7 animate-spin text-brand" /> : <Upload className="size-7 text-brand" />}<span className="mt-4 text-sm font-semibold">{loading === kind ? (sourceProgress[kind]?.label || "Preparing private source") : `Choose ${kind} CSV or XLSX`}</span><span className="mt-1 text-xs text-muted">{workspaceId === "demo" ? "Fictional source data is previewed before it is accepted." : "The browser stays responsive while upload and validation run asynchronously."}</span>{sourceProgress[kind] ? <progress className="mt-4 h-2 w-full max-w-xs accent-brand" value={sourceProgress[kind]?.current} max={sourceProgress[kind]?.total || 100} aria-label={`${labels[kind].title} progress`} /> : null}</button>{sourceIds[kind] ? <Button className="mt-3 w-full" variant="quiet" onClick={() => void removeSource(kind)}><Trash2 className="size-4" />Remove private source</Button> : <Button className="mt-3 w-full" variant="secondary" disabled={loading !== null} onClick={() => void loadSample(kind)}>{loading === kind ? <LoaderCircle className="size-4 animate-spin" /> : null}{loading === kind ? "Loading fictional sample" : `Use fictional sample ${kind === "invoice" ? "invoices" : "payments"}`}</Button>}</div> : <PreviewPanel preview={preview} done={done} isPrivate={workspaceId !== "demo"} onReplace={() => inputRefs[kind].current?.click()} onRemove={() => void removeSource(kind)} onConfirm={() => confirm(kind)} onMappingChange={(field, header) => updateMapping(kind, field, header)} onSheetChange={(sheet) => void changeSheet(kind, sheet)} />}
          <input ref={inputRefs[kind]} className="sr-only" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewFile(kind, file); event.currentTarget.value = ""; }} />
        </section>;
      })}
    </div>
    <div className="mt-6 flex flex-col gap-4 border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{matching && matchingProgress ? matchingProgress.label : accepted.length === 2 ? "Both imports are ready" : `${2 - accepted.length} import ${2 - accepted.length === 1 ? "is" : "are"} still needed`}</p><p className="mt-1 text-sm text-muted">{workspaceId === "demo" ? "Matching runs only after both mappings are confirmed." : "Once queued, reconciliation continues safely if you leave this page. We will notify you in the app, and by email if enabled, when it is ready."}</p>{matchingProgress ? <progress className="mt-3 h-2 w-full max-w-md accent-brand" value={matchingProgress.current} max={matchingProgress.total} aria-label="Background reconciliation progress" /> : null}</div><Button size="lg" disabled={accepted.length !== 2 || matching} onClick={() => void runReconciliation()}>{matching ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{matching ? "Reconciling in background" : workspaceId === "demo" ? "Run reconciliation" : "Queue reconciliation"}</Button></div>
  </div>;
}

function PreviewPanel({ preview, done, isPrivate, onReplace, onRemove, onConfirm, onMappingChange, onSheetChange }: { preview: Preview; done: boolean; isPrivate: boolean; onReplace: () => void; onRemove: () => void; onConfirm: () => void; onMappingChange: (field: string, header: string) => void; onSheetChange: (sheet: string) => void }) {
  return <div className="p-5">
    <div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{preview.file.name}</p><p className="mt-1 text-xs text-muted">{preview.rowCount} data rows</p></div><div className="flex items-center gap-3"><button type="button" className="text-xs font-semibold text-brand hover:underline" onClick={onReplace}>Replace</button>{isPrivate ? <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-danger hover:underline" onClick={onRemove}><Trash2 className="size-3.5" />Remove source</button> : null}</div></div>
    {preview.sheets.length > 1 ? <label className="mt-4 block text-xs font-semibold">Worksheet<select className="mt-1 h-10 w-full border bg-background px-3 text-sm font-normal" value={preview.selectedSheet} onChange={(event) => onSheetChange(event.target.value)}>{preview.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}</select></label> : null}
    {preview.issues.length ? <div className="mt-4 flex gap-3 border border-warning/25 bg-warning-soft p-3 text-sm text-warning"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{preview.issues[0].message}</span></div> : null}
    <div className="mt-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Column mapping</h3>{preview.mappingSource === "saved" ? <span className="bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand">Reused from your latest compatible import</span> : null}</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{fields[preview.kind].map((field) => <label key={field.key} className="border bg-background p-2 text-xs font-semibold"><span>{field.label}{field.required ? " *" : ""}</span><select className="mt-1 h-8 w-full border bg-surface px-2 font-normal" value={preview.mapping[field.key] || ""} onChange={(event) => onMappingChange(field.key, event.target.value)}><option value="">Not mapped</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></div>
    {preview.preview.length ? <div className="mt-5 overflow-x-auto border" tabIndex={0} aria-label={`Scrollable ${preview.kind} file preview`}><table className="w-full min-w-[520px] text-left text-xs"><thead className="border-b bg-surface-muted"><tr>{preview.headers.slice(0, 5).map((header) => <th key={header} className="max-w-32 truncate px-3 py-2 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y">{preview.preview.slice(0, 3).map((row, index) => <tr key={index}>{preview.headers.slice(0, 5).map((header) => <td key={header} className="max-w-32 truncate px-3 py-2 text-muted">{String(row[header] ?? "")}</td>)}</tr>)}</tbody></table></div> : <div className="mt-5 border bg-surface-muted p-3 text-xs leading-5 text-muted">For private background imports, this screen stores only headers, row count, mapping, and safe issue codes. Financial row values are not copied into the workflow or preview-status record.</div>}
    <Button className={cn("mt-5 w-full", done && "text-success")} variant={done ? "secondary" : "primary"} onClick={onConfirm}>{done ? <Check className="size-4" /> : null}{done ? "Mapping confirmed" : "Confirm mapping"}</Button>
  </div>;
}
