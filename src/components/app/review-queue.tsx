"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  FileQuestion,
  Keyboard,
  Plus,
  Search,
  Split,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import {
  amountInputToMinor,
  defaultInvoiceAllocations,
  minorToAmountInput,
  validateInvoiceAllocations,
  type Invoice,
  type InvoiceAllocation,
  type Payment,
  type ProposedMatch,
} from "@/lib/reconciliation";
import { money, shortDate } from "@/lib/demo/workspace";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { WorkspaceDecision as Decision } from "@/lib/reconciliation/workspace-data";

export const REVIEW_QUEUE_PAGE_SIZE = 50;

function storageKey(workspaceId: string) { return `ir_decisions_${workspaceId}_v1`; }

function readDecisions(workspaceId: string): Record<string, Decision> {
  if (typeof window === "undefined") return {};
  try {
    const store = workspaceId === "demo" ? window.localStorage : window.sessionStorage;
    const value = JSON.parse(store.getItem(storageKey(workspaceId)) || "{}");
    return typeof value === "object" && value ? value : {};
  } catch {
    return {};
  }
}

export function MatchStatus({ match, decision }: { match: ProposedMatch; decision?: Decision }) {
  if (decision) return <StatusBadge status="exact" label={decision.outcome === "confirmed" ? "Confirmed" : decision.outcome === "rejected" ? "Rejected" : "Left unmatched"} />;
  if (match.confidence === "exact") return <StatusBadge status="exact" />;
  if (match.confidence === "high_confidence") return <StatusBadge status="high" label="High confidence" />;
  if (match.confidence === "review") return <StatusBadge status="review" />;
  return <StatusBadge status="unmatched" />;
}

export function suggestedDecision(
  match: ProposedMatch,
  invoiceById: Map<string, Invoice>,
  paymentCurrency: string,
  decidedAt: string,
): Decision | null {
  const allocations = defaultInvoiceAllocations(match, invoiceById);
  const appliedAmountMinor = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
  const validation = validateInvoiceAllocations({
    allocations,
    appliedAmountMinor,
    paymentAvailableMinor: match.paymentAmountMinor,
    paymentCurrency,
    invoices: invoiceById,
  });
  if (!validation.ok) return null;
  return {
    matchId: match.id,
    outcome: "confirmed",
    invoiceIds: allocations.map((allocation) => allocation.invoiceId),
    allocations,
    appliedAmountMinor,
    decidedAt,
  };
}

export function ReviewQueue({ workspaceId, runRecordId, persistenceStatus, initialDecisions = {}, matches, invoices, payments }: { workspaceId: string; runRecordId?: string; persistenceStatus?: "durable" | "local"; initialDecisions?: Record<string, Decision>; matches: ProposedMatch[]; invoices: Invoice[]; payments: Payment[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "review" | "unmatched" | "high">("all");
  const [search, setSearch] = useState("");
  const [queuePage, setQueuePage] = useState(0);
  const [activeId, setActiveId] = useState(() => matches.find((match) => match.confidence === "review" || match.confidence === "unmatched")?.id || matches[0]?.id || "");
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initialDecisions);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const durable = persistenceStatus === "durable" && Boolean(runRecordId) && workspaceId !== "demo";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDecisions(durable ? initialDecisions : readDecisions(workspaceId)));
    return () => window.cancelAnimationFrame(frame);
  }, [durable, initialDecisions, workspaceId]);

  const paymentById = useMemo(() => new Map(payments.map((payment) => [payment.id, payment])), [payments]);
  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const queue = useMemo(() => matches.filter((match) => {
    const statusMatch = filter === "all" || (filter === "high" ? match.confidence === "high_confidence" : match.confidence === filter);
    const payment = paymentById.get(match.paymentIds[0]);
    const text = `${payment?.payerName || ""} ${payment?.description || ""} ${match.invoiceIds.map((id) => invoiceById.get(id)?.invoiceNumber || "").join(" ")}`.toLowerCase();
    return statusMatch && text.includes(search.toLowerCase());
  }), [filter, invoiceById, matches, paymentById, search]);
  const queuePageCount = Math.max(1, Math.ceil(queue.length / REVIEW_QUEUE_PAGE_SIZE));
  const visibleQueuePage = Math.min(queuePage, queuePageCount - 1);
  const visibleQueue = queue.slice(visibleQueuePage * REVIEW_QUEUE_PAGE_SIZE, (visibleQueuePage + 1) * REVIEW_QUEUE_PAGE_SIZE);
  const active = queue.find((match) => match.id === activeId) || queue[0];

  const activateMatch = useCallback((matchId: string) => {
    setActiveId(matchId);
    const index = queue.findIndex((match) => match.id === matchId);
    if (index >= 0) setQueuePage(Math.floor(index / REVIEW_QUEUE_PAGE_SIZE));
  }, [queue]);

  const recordDecision = useCallback(async (decision: Decision, options: { advance?: boolean; quiet?: boolean } = {}) => {
    setSavingId(decision.matchId);
    let savedDecision = decision;
    if (durable && runRecordId) {
      try {
        const response = await fetch("/api/reconciliation/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            runRecordId,
            matchId: decision.matchId,
            outcome: decision.outcome,
            allocations: decision.allocations || [],
            appliedAmountMinor: decision.appliedAmountMinor || 0,
            note: decision.note,
            feeMinor: decision.feeMinor,
            feedback: decision.feedback,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        const body = await response.json() as { decision?: Decision; error?: string };
        if (!response.ok || !body.decision) throw new Error(body.error || "The decision could not be saved.");
        savedDecision = body.decision;
      } catch (error) {
        toast.error("Decision not saved", { description: error instanceof Error ? error.message : "No reconciliation balances were changed." });
        setSavingId(null);
        return false;
      }
    }
    if (!durable) {
      try {
        const store = workspaceId === "demo" ? window.localStorage : window.sessionStorage;
        const persisted = { ...decisions, ...readDecisions(workspaceId), [savedDecision.matchId]: savedDecision };
        store.setItem(storageKey(workspaceId), JSON.stringify(persisted));
      } catch {
        toast.error("Decision not saved", { description: "This browser could not store the local decision." });
        setSavingId(null);
        return false;
      }
    }
    setDecisions((current) => ({ ...current, [savedDecision.matchId]: savedDecision }));
    const reviewResult = savedDecision.outcome === "confirmed"
      ? "confirmed"
      : savedDecision.outcome === "rejected"
        ? "rejected"
        : "completed";
    sendAnalyticsEvent("exception_reviewed", { result: reviewResult, source: "in_app" });
    if (savedDecision.outcome === "confirmed") {
      sendAnalyticsEvent("match_confirmed", { result: "confirmed", source: "in_app" });
    } else if (savedDecision.outcome === "rejected") {
      sendAnalyticsEvent("match_rejected", { result: "rejected", source: "in_app" });
    }
    const currentIndex = queue.findIndex((match) => match.id === decision.matchId);
    const next = queue[currentIndex + 1] || queue.find((match) => match.id !== decision.matchId && !decisions[match.id]);
    if (options.advance !== false && next) activateMatch(next.id);
    if (!options.quiet) {
      const label = decision.outcome === "confirmed" ? "Match confirmed" : decision.outcome === "rejected" ? "Suggestion rejected" : "Payment left unmatched";
      toast.success(label, { description: durable ? "Saved to the workspace audit trail." : "Saved on this device only." });
    }
    setSavingId(null);
    if (durable) router.refresh();
    return true;
  }, [activateMatch, decisions, durable, queue, router, runRecordId, workspaceId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, [contenteditable=true]") || !active || savingId !== null || decisions[active.id]) return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        const nextDecision = suggestedDecision(
          active,
          invoiceById,
          paymentById.get(active.paymentIds[0])?.currency || invoiceById.get(active.invoiceIds[0])?.currency || "USD",
          new Date().toISOString(),
        );
        if (!nextDecision) {
          toast.error("The suggested allocation is no longer valid. Review the invoice amounts before confirming.");
          return;
        }
        void recordDecision(nextDecision);
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void recordDecision({ matchId: active.id, outcome: "rejected", invoiceIds: [], decidedAt: new Date().toISOString() });
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        const index = queue.findIndex((match) => match.id === active.id);
        if (queue[index + 1]) activateMatch(queue[index + 1].id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateMatch, active, decisions, invoiceById, paymentById, queue, recordDecision, savingId]);

  async function approveHighConfidence() {
    const pending = visibleQueue.filter((match) => match.confidence === "high_confidence" && !decisions[match.id]);
    if (!pending.length) return;
    setBulkSaving(true);
    const now = new Date().toISOString();
    let saved = 0;
    for (const match of pending) {
      const decision = suggestedDecision(
        match,
        invoiceById,
        paymentById.get(match.paymentIds[0])?.currency || invoiceById.get(match.invoiceIds[0])?.currency || "USD",
        now,
      );
      if (decision && await recordDecision(decision, { advance: false, quiet: true })) saved += 1;
    }
    setBulkSaving(false);
    if (saved) toast.success(`${saved} high-confidence ${saved === 1 ? "match" : "matches"} confirmed`, { description: durable ? "Each decision was committed to the workspace audit trail." : "Saved on this device only." });
  }

  return (
    <div className="mx-auto max-w-[1460px]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">Exception inbox</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Review payment matches</h1><p className="mt-2 text-sm text-muted">Inspect the evidence, make the accounting decision, and keep a traceable record.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={bulkSaving || savingId !== null} onClick={() => void approveHighConfidence()}><Check className="size-4" /> {bulkSaving ? "Saving visible approvals" : "Approve visible high confidence"}</Button><div className="inline-flex items-center gap-2 border bg-surface px-3 text-xs text-muted"><Keyboard className="size-4" /><kbd>A</kbd> approve <kbd>R</kbd> reject <kbd>N</kbd> next</div></div>
      </div>

      <div className="mt-6 grid min-h-[680px] border bg-surface xl:grid-cols-[390px_1fr]">
        <aside className="border-b xl:border-r xl:border-b-0">
          <div className="border-b p-3">
            <label className="relative block"><span className="sr-only">Search exception queue</span><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" /><input className="h-9 w-full border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand" placeholder="Search payer, memo, or invoice" value={search} onChange={(event) => { setSearch(event.target.value); setQueuePage(0); }} /></label>
            <div className="mt-2 grid grid-cols-4 gap-1" aria-label="Filter matches">
              {(["all", "review", "unmatched", "high"] as const).map((value) => <button key={value} type="button" onClick={() => { setFilter(value); setQueuePage(0); }} className={cn("border px-2 py-2 text-xs font-semibold capitalize", filter === value ? "border-brand bg-brand-soft text-brand" : "bg-surface text-muted hover:text-foreground")}>{value}</button>)}
            </div>
          </div>
          <div className="max-h-[585px] overflow-y-auto">
            {queue.length ? visibleQueue.map((match) => {
              const payment = paymentById.get(match.paymentIds[0]);
              return <button data-testid="review-queue-item" key={match.id} type="button" onClick={() => activateMatch(match.id)} className={cn("block w-full border-b p-4 text-left transition hover:bg-surface-muted", active?.id === match.id ? "border-l-4 border-l-brand bg-brand-soft/60 pl-3" : "")}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{payment?.payerName || "Unknown payer"}</p><p className="mt-1 truncate font-mono text-[11px] text-muted">{payment?.description || "No payment memo"}</p></div><p className="numeric shrink-0 text-sm font-semibold">{money(match.paymentAmountMinor)}</p></div>
                <div className="mt-3 flex items-center justify-between gap-3"><MatchStatus match={match} decision={decisions[match.id]} /><span className="text-xs text-muted">{payment ? shortDate(payment.paymentDate) : ""}</span></div>
              </button>;
            }) : <div className="p-8 text-center"><Search className="mx-auto size-6 text-muted" /><p className="mt-3 text-sm font-semibold">No queue items found</p><p className="mt-1 text-xs text-muted">Change the search or status filter.</p></div>}
          </div>
          {queue.length > REVIEW_QUEUE_PAGE_SIZE ? <div className="flex items-center justify-between gap-2 border-t p-3">
            <Button aria-label="Previous queue page" variant="quiet" size="sm" disabled={visibleQueuePage === 0} onClick={() => setQueuePage((current) => Math.max(0, current - 1))}><ChevronLeft className="size-4" /> Previous</Button>
            <span className="text-center text-xs text-muted" aria-live="polite">Page {visibleQueuePage + 1} of {queuePageCount}<span className="block">{visibleQueuePage * REVIEW_QUEUE_PAGE_SIZE + 1}-{Math.min(queue.length, (visibleQueuePage + 1) * REVIEW_QUEUE_PAGE_SIZE)} of {queue.length}</span></span>
            <Button aria-label="Next queue page" variant="quiet" size="sm" disabled={visibleQueuePage >= queuePageCount - 1} onClick={() => setQueuePage((current) => Math.min(queuePageCount - 1, current + 1))}>Next <ChevronRight className="size-4" /></Button>
          </div> : null}
        </aside>

        {active ? <MatchDetail key={active.id} match={active} payment={paymentById.get(active.paymentIds[0])} invoices={invoices} invoiceById={invoiceById} decision={decisions[active.id]} saving={savingId === active.id} onDecision={recordDecision} /> : <div className="grid place-items-center p-8 text-center"><div><FileQuestion className="mx-auto size-8 text-muted" /><p className="mt-3 font-semibold">Select a match to review</p></div></div>}
      </div>
    </div>
  );
}

export function MatchDetail({ match, payment, invoices, invoiceById, decision, saving, onDecision, onInvoiceSearch }: { match: ProposedMatch; payment?: Payment; invoices: Invoice[]; invoiceById: Map<string, Invoice>; decision?: Decision; saving: boolean; onDecision: (decision: Decision) => Promise<boolean>; onInvoiceSearch?: (query: string) => Promise<Invoice[]> }) {
  const [remoteInvoices, setRemoteInvoices] = useState<Invoice[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [searchingInvoices, setSearchingInvoices] = useState(false);
  const availableInvoiceById = useMemo(() => new Map([...invoiceById, ...remoteInvoices.map((invoice) => [invoice.id, invoice] as const)]), [invoiceById, remoteInvoices]);
  const initialAllocations = useMemo(() => defaultInvoiceAllocations(match, availableInvoiceById), [availableInvoiceById, match]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => initialAllocations.map((allocation) => allocation.invoiceId));
  const [amountByInvoiceId, setAmountByInvoiceId] = useState<Record<string, string>>(() => Object.fromEntries(
    initialAllocations.map((allocation) => [allocation.invoiceId, minorToAmountInput(allocation.amountMinor)]),
  ));
  const [alternate, setAlternate] = useState("");
  const [note, setNote] = useState("");
  const [fee, setFee] = useState(match.method === "possible_fee_or_deduction" ? Math.abs(match.discrepancyMinor) / 100 : 0);
  const [splitMode, setSplitMode] = useState(match.invoiceIds.length > 1);
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | undefined>();
  const selectedInvoices = selectedIds.map((id) => availableInvoiceById.get(id)).filter(Boolean) as Invoice[];
  const paymentCurrency = payment?.currency || selectedInvoices[0]?.currency || "USD";
  const allocationDraft = (() => {
    const allocations: InvoiceAllocation[] = [];
    for (const invoiceId of selectedIds) {
      const amountMinor = amountInputToMinor(amountByInvoiceId[invoiceId] || "");
      if (amountMinor === null) return { allocations: [] as InvoiceAllocation[], error: "Enter each application amount with no more than two decimal places." };
      allocations.push({ invoiceId, amountMinor });
    }
    return { allocations };
  })();
  const allocationTotalMinor = allocationDraft.allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
  const allocationValidation = allocationDraft.error
    ? { ok: false as const, error: allocationDraft.error }
    : validateInvoiceAllocations({
        allocations: allocationDraft.allocations,
        appliedAmountMinor: allocationTotalMinor,
        paymentAvailableMinor: match.paymentAmountMinor,
        paymentCurrency,
        invoices: availableInvoiceById,
      });

  function addAlternate() {
    if (!alternate || selectedIds.includes(alternate)) return;
    const invoice = availableInvoiceById.get(alternate);
    if (!invoice) return;
    const remainingMinor = Math.max(0, match.paymentAmountMinor - allocationTotalMinor);
    const amountMinor = Math.min(invoice.outstandingAmountMinor, Math.max(1, remainingMinor));
    setSelectedIds((current) => [...current, alternate]);
    setAmountByInvoiceId((current) => ({ ...current, [alternate]: minorToAmountInput(amountMinor) }));
    setAlternate("");
  }

  async function searchAlternateInvoices() {
    if (!onInvoiceSearch) return;
    setSearchingInvoices(true);
    try {
      setRemoteInvoices(await onInvoiceSearch(invoiceSearch));
    } catch {
      toast.error("Invoice search is temporarily unavailable.");
    } finally {
      setSearchingInvoices(false);
    }
  }

  function removeInvoice(invoiceId: string) {
    setSelectedIds((current) => current.filter((id) => id !== invoiceId));
    setAmountByInvoiceId((current) => {
      const next = { ...current };
      delete next[invoiceId];
      return next;
    });
  }

  async function decide(outcome: Decision["outcome"]) {
    if (outcome === "confirmed" && !allocationValidation.ok) {
      toast.error("Review the invoice allocations", { description: allocationValidation.error });
      return;
    }
    const allocations = outcome === "confirmed" ? allocationDraft.allocations : [];
    const next: Decision = {
      matchId: match.id,
      outcome,
      invoiceIds: allocations.map((allocation) => allocation.invoiceId),
      allocations,
      appliedAmountMinor: outcome === "confirmed" ? allocationTotalMinor : 0,
      note: note.trim() || undefined,
      feeMinor: fee > 0 ? Math.round(fee * 100) : undefined,
      feedback,
      decidedAt: new Date().toISOString(),
    };
    await onDecision(next);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 border-b bg-surface-muted p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.09em] text-muted">Match explanation</p><h2 className="mt-1 font-semibold">{match.method.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase())}</h2></div><MatchStatus match={match} decision={decision} /></div>

      <div className="grid border-b lg:grid-cols-2">
        <section className="border-b p-5 sm:p-6 lg:border-r lg:border-b-0">
          <p className="text-xs font-bold uppercase tracking-[0.09em] text-muted">Payment</p>
          <div className="mt-5 flex items-start justify-between gap-5"><div><h3 className="font-semibold">{payment?.payerName || "Unknown payer"}</h3><p className="mt-1 max-w-sm font-mono text-xs leading-5 text-muted">{payment?.description || "No memo provided"}</p></div><p className="numeric text-xl font-semibold">{money(match.paymentAmountMinor, payment?.currency)}</p></div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t pt-4 text-sm"><div><dt className="text-xs text-muted">Date</dt><dd className="mt-1 font-medium">{payment ? shortDate(payment.paymentDate) : "Unknown"}</dd></div><div><dt className="text-xs text-muted">Reference</dt><dd className="mt-1 truncate font-mono text-xs font-medium">{payment?.transactionId || payment?.bankReference || "Not provided"}</dd></div><div><dt className="text-xs text-muted">Currency</dt><dd className="mt-1 font-medium">{payment?.currency || "USD"}</dd></div><div><dt className="text-xs text-muted">Source row</dt><dd className="mt-1 font-medium">{payment?.sourceRow || "Demo import"}</dd></div></dl>
        </section>
        <section className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[0.09em] text-muted">Suggested invoices</p><button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand" onClick={() => setSplitMode((value) => !value)}><Split className="size-3.5" />{splitMode ? "Done selecting" : "Split or combine"}</button></div>
          <div className="mt-4 divide-y border-y">{selectedInvoices.length ? selectedInvoices.map((invoice) => <div key={invoice.id} className="grid gap-3 py-3 sm:grid-cols-[auto_1fr_130px] sm:items-center"><button type="button" className="inline-flex size-5 shrink-0 items-center justify-center border border-success bg-success-soft text-success" onClick={() => removeInvoice(invoice.id)} aria-label={`Remove ${invoice.invoiceNumber}`}><Check className="size-3" /></button><div className="min-w-0"><p className="font-mono text-xs font-semibold">{invoice.invoiceNumber}</p><p className="mt-1 truncate text-xs text-muted">{invoice.customerName} · {money(invoice.outstandingAmountMinor, invoice.currency)} outstanding</p></div><label className="text-xs font-semibold text-muted">Apply amount<input aria-label={`Apply amount to ${invoice.invoiceNumber}`} className="mt-1 h-9 w-full border bg-background px-2 text-right font-mono text-sm text-foreground outline-none focus:border-brand" inputMode="decimal" value={amountByInvoiceId[invoice.id] || ""} onChange={(event) => setAmountByInvoiceId((current) => ({ ...current, [invoice.id]: event.target.value }))} /></label></div>) : <p className="py-5 text-sm text-muted">No invoice selected. Choose one below.</p>}</div>
          {splitMode ? <div className="mt-4 space-y-2">{onInvoiceSearch ? <div className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Search open invoices</span><input className="h-9 w-full border bg-background px-3 text-sm" value={invoiceSearch} maxLength={100} placeholder="Search invoice or customer" onChange={(event) => setInvoiceSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchAlternateInvoices(); } }} /></label><Button variant="secondary" size="sm" disabled={searchingInvoices} onClick={() => void searchAlternateInvoices()}>{searchingInvoices ? "Searching" : "Search"}</Button></div> : null}<div className="flex gap-2"><label className="sr-only" htmlFor="alternate-invoice">Choose another invoice</label><div className="relative min-w-0 flex-1"><select id="alternate-invoice" className="h-10 w-full appearance-none border bg-background pl-3 pr-8 text-sm" value={alternate} onChange={(event) => setAlternate(event.target.value)}><option value="">Choose another invoice</option>{[...invoices, ...remoteInvoices].filter((invoice, index, candidates) => candidates.findIndex((candidate) => candidate.id === invoice.id) === index && !selectedIds.includes(invoice.id) && invoice.outstandingAmountMinor > 0 && invoice.currency === paymentCurrency).map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.customerName} · {money(invoice.outstandingAmountMinor, invoice.currency)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-4 text-muted" /></div><Button variant="secondary" size="sm" onClick={addAlternate} disabled={!alternate}><Plus className="size-4" /> Add</Button></div></div> : null}
          {selectedInvoices.length ? <div className={cn("mt-4 border p-3", allocationValidation.ok ? "bg-surface-muted" : "border-danger/40 bg-danger-soft")}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold">Application total</span><span className="numeric font-semibold">{money(allocationTotalMinor, paymentCurrency)} of {money(match.paymentAmountMinor, paymentCurrency)}</span></div>{allocationValidation.ok ? <p className="mt-1 text-xs leading-5 text-muted">{allocationValidation.remainingPaymentMinor > 0 ? `${money(allocationValidation.remainingPaymentMinor, paymentCurrency)} will remain unapplied.` : "The payment is fully allocated."} The exact amounts will be recorded in the audit trail.</p> : <p className="mt-1 text-xs leading-5 text-danger">{allocationValidation.error}</p>}</div> : null}
        </section>
      </div>

      <section className="border-b p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.09em] text-muted">Why this match was suggested</p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">{match.evidence.map((evidence, index) => <li key={`${evidence.code}-${index}`} className={cn("flex gap-3 border-l-2 py-1 pl-3 text-sm leading-6", evidence.strength === "warning" ? "border-warning" : "border-success")}>
          {evidence.strength === "warning" ? <AlertTriangle className="mt-1 size-4 shrink-0 text-warning" /> : <Check className="mt-1 size-4 shrink-0 text-success" />}<span>{evidence.message}</span>
        </li>)}</ul>
        <dl className="mt-5 grid gap-px border bg-border sm:grid-cols-4"><div className="bg-surface p-3"><dt className="text-xs text-muted">Payment</dt><dd className="numeric mt-1 font-semibold">{money(match.paymentAmountMinor)}</dd></div><div className="bg-surface p-3"><dt className="text-xs text-muted">Invoice total</dt><dd className="numeric mt-1 font-semibold">{money(match.invoiceAmountMinor)}</dd></div><div className="bg-surface p-3"><dt className="text-xs text-muted">Difference</dt><dd className={cn("numeric mt-1 font-semibold", match.discrepancyMinor ? "text-warning" : "text-success")}>{money(match.discrepancyMinor)}</dd></div><div className="bg-surface p-3"><dt className="text-xs text-muted">Unapplied</dt><dd className="numeric mt-1 font-semibold">{money(match.unappliedPaymentMinor)}</dd></div></dl>
      </section>

      <section className="p-5 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          <label className="block text-sm font-semibold">Review note<textarea className="mt-1.5 min-h-20 w-full resize-y border bg-background p-3 text-sm font-normal outline-none focus:border-brand" placeholder="Optional note for the audit trail" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <label className="block text-sm font-semibold">Fee or deduction<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal outline-none focus:border-brand" type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(Number(event.target.value))} /><span className="mt-1 block text-xs font-normal text-muted">Leave at $0 unless you verified the difference.</span></label>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm"><span className="text-muted">Was this suggestion correct?</span><button type="button" aria-pressed={feedback === "correct"} className={cn("inline-flex size-8 items-center justify-center border", feedback === "correct" ? "border-success bg-success-soft text-success" : "")} onClick={() => setFeedback("correct")}><ThumbsUp className="size-4" /><span className="sr-only">Yes</span></button><button type="button" aria-pressed={feedback === "incorrect"} className={cn("inline-flex size-8 items-center justify-center border", feedback === "incorrect" ? "border-danger bg-danger-soft text-danger" : "")} onClick={() => setFeedback("incorrect")}><ThumbsDown className="size-4" /><span className="sr-only">No</span></button></div>
          <div className="flex flex-wrap gap-2"><Button variant="quiet" disabled={saving || Boolean(decision)} onClick={() => void decide("unmatched")}><CircleOff className="size-4" /> Leave unmatched</Button><Button variant="secondary" disabled={saving || Boolean(decision)} onClick={() => void decide("rejected")}><X className="size-4" /> Reject</Button><Button disabled={saving || Boolean(decision) || !allocationValidation.ok} onClick={() => void decide("confirmed")}><Check className="size-4" /> {saving ? "Saving decision" : decision ? "Decision saved" : "Confirm application"}</Button></div>
        </div>
      </section>
    </div>
  );
}
