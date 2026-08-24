import Link from "next/link";
import {
  Check,
  CircleOff,
  Download,
  FileClock,
  Scale,
  ThumbsDown,
  type LucideIcon,
} from "lucide-react";
import { WorkspaceDataUnavailable } from "@/components/app/data-unavailable";
import { buttonVariants } from "@/components/ui/button";
import { money } from "@/lib/demo/workspace";
import {
  loadWorkspaceAuditEvents,
  type WorkspaceAuditEvent,
} from "@/lib/reconciliation/audit";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";

type SourceImport = { id: string; type?: string; filename?: string; acceptedRows?: number; rejectedRows?: number };
type PaymentLink = { paymentId: string; amountMinor?: number; currency?: string; transactionId?: string; sourceImportId?: string };
type MatchEvidence = { code: string; message?: string; strength?: string };
type InvoiceApplication = { invoiceId: string; invoiceNumber?: string; appliedAmountMinor?: number; resultingOutstandingAmountMinor?: number };

function eventTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function textMetadata(event: WorkspaceAuditEvent, key: string) {
  const value = event.metadata[key];
  return typeof value === "string" ? value : null;
}

function numberMetadata(event: WorkspaceAuditEvent, key: string) {
  const value = event.metadata[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function sourceImports(event: WorkspaceAuditEvent): SourceImport[] {
  const values = event.metadata.source_imports;
  if (Array.isArray(values)) {
    return values.flatMap((value): SourceImport[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      if (typeof record.id !== "string") return [];
      return [{
        id: record.id,
        type: typeof record.type === "string" ? record.type : undefined,
        filename: typeof record.filename === "string" ? record.filename : undefined,
        acceptedRows: typeof record.accepted_rows === "number" ? record.accepted_rows : undefined,
        rejectedRows: typeof record.rejected_rows === "number" ? record.rejected_rows : undefined,
      }];
    });
  }
  return event.sourceImport ? [event.sourceImport] : [];
}

function paymentLinks(event: WorkspaceAuditEvent): PaymentLink[] {
  const values = event.metadata.payment_links;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): PaymentLink[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record.paymentId !== "string") return [];
    return [{
      paymentId: record.paymentId,
      amountMinor: typeof record.amountMinor === "number" ? record.amountMinor : undefined,
      currency: typeof record.currency === "string" ? record.currency : undefined,
      transactionId: typeof record.transactionId === "string" ? record.transactionId : undefined,
      sourceImportId: typeof record.sourceImportId === "string" ? record.sourceImportId : undefined,
    }];
  });
}

function matchEvidence(event: WorkspaceAuditEvent): MatchEvidence[] {
  const values = event.metadata.match_evidence;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): MatchEvidence[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record.code !== "string") return [];
    return [{ code: record.code, message: typeof record.message === "string" ? record.message : undefined, strength: typeof record.strength === "string" ? record.strength : undefined }];
  });
}

function invoiceApplications(event: WorkspaceAuditEvent): InvoiceApplication[] {
  const values = event.action?.newState.invoiceApplications;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value): InvoiceApplication[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    if (typeof record.invoiceId !== "string") return [];
    return [{
      invoiceId: record.invoiceId,
      invoiceNumber: typeof record.invoiceNumber === "string" ? record.invoiceNumber : undefined,
      appliedAmountMinor: typeof record.appliedAmountMinor === "number" ? record.appliedAmountMinor : undefined,
      resultingOutstandingAmountMinor: typeof record.resultingOutstandingAmountMinor === "number" ? record.resultingOutstandingAmountMinor : undefined,
    }];
  });
}

function eventPresentation(event: WorkspaceAuditEvent): { title: string; summary: string; icon: LucideIcon } {
  if (event.eventType === "reconciliation_run.completed") {
    const payments = numberMetadata(event, "payment_count") || 0;
    const matches = numberMetadata(event, "match_count") || 0;
    return { title: "Completed reconciliation run", summary: `${payments} payments processed and ${matches} payment results proposed`, icon: Scale };
  }
  if (event.eventType === "reconciliation_match.confirmed") {
    const applied = numberMetadata(event, "applied_amount_minor");
    const currency = textMetadata(event, "currency_code") || "USD";
    return { title: "Confirmed invoice application", summary: applied === null ? "Saved a reviewed match decision" : `${money(applied, currency)} applied`, icon: Check };
  }
  if (event.eventType === "reconciliation_match.rejected") {
    return { title: "Rejected match suggestion", summary: "Kept the payment unapplied", icon: ThumbsDown };
  }
  if (event.eventType === "reconciliation_match.unmatched") {
    return { title: "Left payment unmatched", summary: "Saved an explicit unmatched decision", icon: CircleOff };
  }
  if (event.eventType === "reconciliation_export.created") {
    const exportType = (textMetadata(event, "export_type") || "reconciliation").replaceAll("_", " ");
    const fileType = (textMetadata(event, "file_type") || "file").toUpperCase();
    const rows = numberMetadata(event, "row_count") || 0;
    return { title: `Created ${exportType} export`, summary: `${fileType} with ${rows} data rows`, icon: Download };
  }
  return {
    title: event.eventType.replaceAll(".", " ").replaceAll("_", " "),
    summary: event.entity?.type ? `${event.entity.type.replaceAll("_", " ")} event` : "Workspace event",
    icon: FileClock,
  };
}

function demoEvents(data: Awaited<ReturnType<typeof loadLatestReconciliationRun>>): WorkspaceAuditEvent[] {
  if (data.status !== "ready") return [];
  const createdAt = data.data.completedAt || new Date().toISOString();
  return [{
    id: "demo-run",
    eventType: "reconciliation_run.completed",
    actor: { type: "user", name: "Jordan Lee" },
    entity: { type: "reconciliation_run", id: data.data.runId },
    metadata: {
      payment_count: data.data.payments.length,
      match_count: data.data.result.matches.length,
      source_imports: data.data.sourceFiles ? [
        { id: "demo-invoices", type: "invoices", filename: data.data.sourceFiles.invoice.name, accepted_rows: data.data.sourceFiles.invoice.accepted, rejected_rows: data.data.sourceFiles.invoice.rejected },
        { id: "demo-payments", type: "payments", filename: data.data.sourceFiles.payment.name, accepted_rows: data.data.sourceFiles.payment.accepted, rejected_rows: data.data.sourceFiles.payment.rejected },
      ] : [],
    },
    createdAt,
  }];
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const requestedCursor = Array.isArray(query.before) ? query.before[0] : query.before;
  const before = requestedCursor && /^\d{1,19}$/.test(requestedCursor) ? requestedCursor : null;
  let events: WorkspaceAuditEvent[];
  let nextCursor: string | null = null;

  if (workspaceId === "demo") {
    events = demoEvents(await loadLatestReconciliationRun(workspaceId));
  } else {
    const result = await loadWorkspaceAuditEvents(workspaceId, before);
    if (result.status === "unavailable") return <WorkspaceDataUnavailable />;
    events = result.events;
    nextCursor = result.nextCursor;
  }

  if (!events.length && !before) {
    return <div className="mx-auto max-w-3xl border bg-surface p-8 text-center"><FileClock className="mx-auto size-8 text-brand" /><h1 className="mt-4 text-2xl font-semibold">No reconciliation history yet</h1><p className="mt-2 text-sm text-muted">Completed imports, saved review decisions, and exports will appear here.</p></div>;
  }

  return <div className="mx-auto max-w-5xl">
    <div><p className="eyebrow">Audit log</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Reconciliation history</h1><p className="mt-2 text-sm text-muted">Immutable run, decision, and export events with their source records and saved state changes.</p></div>
    <section className="mt-6 border bg-surface">
      <div className="flex items-center justify-between gap-4 border-b bg-surface-muted px-5 py-3 text-xs font-semibold text-muted"><span>{workspaceId === "demo" ? "Fictional demo events" : "Saved workspace events"}</span>{before ? <Link className="text-brand hover:underline" href={`/app/${workspaceId}/audit`}>Return to latest</Link> : null}</div>
      {events.length ? <ol className="divide-y">{events.map((event) => {
        const presentation = eventPresentation(event);
        const imports = sourceImports(event);
        const payments = paymentLinks(event);
        const evidence = matchEvidence(event);
        const applications = invoiceApplications(event);
        const method = textMetadata(event, "matching_method");
        const confidence = textMetadata(event, "confidence");
        const currency = textMetadata(event, "currency_code") || "USD";
        return <li key={event.id} className="grid gap-4 p-5 sm:grid-cols-[175px_1fr_190px]">
          <time dateTime={event.createdAt} className="text-xs leading-5 text-muted">{eventTime(event.createdAt)}</time>
          <div className="min-w-0">
            <div className="flex gap-3"><span className="inline-flex size-8 shrink-0 items-center justify-center bg-brand-soft text-brand"><presentation.icon className="size-4" /></span><div className="min-w-0"><p className="text-sm font-semibold">{presentation.title}</p><p className="mt-1 text-xs text-muted">{presentation.summary}</p></div></div>
            {method ? <p className="mt-3 text-xs text-muted"><span className="font-semibold text-foreground">Automated proposal:</span> {method.replaceAll("_", " ")}{confidence ? ` · ${confidence.replaceAll("_", " ")} confidence` : ""}</p> : null}
            {imports.length ? <ul className="mt-3 space-y-1 border-l-2 border-brand-soft pl-3">{imports.map((source) => <li key={source.id} className="text-xs text-muted"><span className="font-semibold text-foreground">{source.filename || source.type || "Source import"}</span>{source.acceptedRows === undefined ? null : ` · ${source.acceptedRows} accepted · ${source.rejectedRows || 0} rejected`}<span className="mt-0.5 block font-mono text-[10px]">Import {source.id}</span></li>)}</ul> : null}
            {payments.length ? <div className="mt-3"><p className="text-xs font-semibold text-muted">Linked payments</p><ul className="mt-1 space-y-1">{payments.map((payment) => <li key={payment.paymentId} className="text-xs text-muted"><span className="font-mono text-foreground">{payment.transactionId || payment.paymentId}</span>{payment.amountMinor === undefined ? null : ` · ${money(payment.amountMinor, payment.currency || currency)}`}{payment.sourceImportId ? <span className="block font-mono text-[10px]">Source import {payment.sourceImportId}</span> : null}</li>)}</ul></div> : null}
            {applications.length ? <div className="mt-3"><p className="text-xs font-semibold text-muted">Saved invoice applications</p><ul className="mt-1 space-y-1">{applications.map((application) => <li key={application.invoiceId} className="text-xs text-muted"><span className="font-mono text-foreground">{application.invoiceNumber || application.invoiceId}</span>{application.appliedAmountMinor === undefined ? null : ` · ${money(application.appliedAmountMinor, currency)} applied`}{application.resultingOutstandingAmountMinor === undefined ? null : ` · ${money(application.resultingOutstandingAmountMinor, currency)} remaining`}</li>)}</ul></div> : null}
            {evidence.length ? <div className="mt-3"><p className="text-xs font-semibold text-muted">Automated matching evidence</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted">{evidence.map((item, index) => <li key={`${item.code}-${index}`}>{item.message || item.code.replaceAll("_", " ")}{item.strength ? ` (${item.strength})` : ""}</li>)}</ul></div> : null}
            {event.action ? <details className="mt-3 border bg-background p-3 text-xs"><summary className="cursor-pointer font-semibold text-brand">View recorded state change</summary>{event.action.note ? <p className="mt-3 leading-5"><span className="font-semibold">Review note:</span> {event.action.note}</p> : null}<div className="mt-3 grid gap-3 lg:grid-cols-2"><div><p className="font-semibold text-muted">Previous state</p><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all bg-surface-muted p-2 font-mono text-[10px] leading-4">{JSON.stringify(event.action.previousState, null, 2)}</pre></div><div><p className="font-semibold text-muted">New state</p><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all bg-surface-muted p-2 font-mono text-[10px] leading-4">{JSON.stringify(event.action.newState, null, 2)}</pre></div></div></details> : null}
            {event.entity?.id ? <p className="mt-3 truncate font-mono text-[10px] text-muted" title={event.entity.id}>{event.entity.type} {event.entity.id}</p> : null}
          </div>
          <div className="text-xs leading-5 text-muted sm:text-right"><p className="font-semibold text-foreground">{event.actor.name}</p><p className="capitalize">{event.actor.type}</p>{event.actor.id ? <p className="mt-1 truncate font-mono text-[10px]" title={event.actor.id}>{event.actor.id}</p> : null}</div>
        </li>;
      })}</ol> : <div className="p-8 text-center text-sm text-muted">No older events were found for this cursor.</div>}
    </section>
    <div className="mt-5 flex justify-end">{nextCursor ? <Link className={buttonVariants({ variant: "secondary" })} href={`/app/${workspaceId}/audit?before=${nextCursor}`}>Older events</Link> : null}</div>
  </div>;
}
