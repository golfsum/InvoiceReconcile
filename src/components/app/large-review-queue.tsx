"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileQuestion, Keyboard, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MatchDetail, MatchStatus, suggestedDecision } from "@/components/app/review-queue";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { money, shortDate } from "@/lib/demo/workspace";
import { cn } from "@/lib/utils";
import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";
import type { WorkspaceDecision as Decision } from "@/lib/reconciliation/workspace-data";

const PAGE_SIZE = 50;

type MatchPage = {
  runRecordId: string;
  runKey: string;
  completedAt: string;
  itemType: "match";
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  items: ProposedMatch[];
  relatedInvoices: Invoice[];
  relatedPayments: Payment[];
  decisions: Record<string, Decision>;
};

export function LargeReviewQueue({ workspaceId, initialPage }: { workspaceId: string; initialPage: MatchPage }) {
  const [filter, setFilter] = useState<"all" | "review" | "unmatched" | "high">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState(initialPage);
  const [activeId, setActiveId] = useState(initialPage.items[0]?.id || "");
  const [decisions, setDecisions] = useState(initialPage.decisions);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const skipInitialRequest = useRef(true);
  const paymentById = useMemo(() => new Map(data.relatedPayments.map((payment) => [payment.id, payment])), [data.relatedPayments]);
  const invoiceById = useMemo(() => new Map(data.relatedInvoices.map((invoice) => [invoice.id, invoice])), [data.relatedInvoices]);
  const active = data.items.find((match) => match.id === activeId) || data.items[0];
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  useEffect(() => {
    if (skipInitialRequest.current && page === 0 && filter === "all" && search === "") {
      skipInitialRequest.current = false;
      return;
    }
    skipInitialRequest.current = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError(false);
      const query = new URLSearchParams({
        workspaceId,
        type: "match",
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE),
        search,
        status: filter,
      });
      void fetch(`/api/reconciliation/runs/latest/items?${query}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("page unavailable");
          const result = await response.json() as MatchPage;
          if (!Array.isArray(result.items) || result.items.length > PAGE_SIZE
              || !Array.isArray(result.relatedInvoices) || !Array.isArray(result.relatedPayments)
              || typeof result.total !== "number" || !result.decisions) throw new Error("invalid page");
          setData(result);
          setDecisions((current) => ({ ...current, ...result.decisions }));
          setActiveId((current) => result.items.some((match) => match.id === current) ? current : result.items[0]?.id || "");
        })
        .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filter, page, search, workspaceId]);

  const recordDecision = useCallback(async (decision: Decision, options: { advance?: boolean; quiet?: boolean } = {}) => {
    setSavingId(decision.matchId);
    try {
      const response = await fetch("/api/reconciliation/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          runRecordId: data.runRecordId,
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
      setDecisions((current) => ({ ...current, [body.decision!.matchId]: body.decision! }));
      const result = body.decision.outcome === "confirmed" ? "confirmed" : body.decision.outcome === "rejected" ? "rejected" : "completed";
      sendAnalyticsEvent("exception_reviewed", { result, source: "in_app" });
      if (body.decision.outcome === "confirmed") sendAnalyticsEvent("match_confirmed", { result: "confirmed", source: "in_app" });
      if (body.decision.outcome === "rejected") sendAnalyticsEvent("match_rejected", { result: "rejected", source: "in_app" });
      if (options.advance !== false) {
        const currentIndex = data.items.findIndex((match) => match.id === decision.matchId);
        const next = data.items[currentIndex + 1];
        if (next) setActiveId(next.id);
        else if (page < pages - 1) setPage((current) => current + 1);
      }
      if (!options.quiet) toast.success("Decision saved", { description: "Saved to the workspace audit trail." });
      return true;
    } catch (error) {
      toast.error("Decision not saved", { description: error instanceof Error ? error.message : "No reconciliation balances were changed." });
      return false;
    } finally {
      setSavingId(null);
    }
  }, [data.items, data.runRecordId, page, pages, workspaceId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, [contenteditable=true]") || !active || savingId !== null || decisions[active.id]) return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        const decision = suggestedDecision(active, invoiceById, paymentById.get(active.paymentIds[0])?.currency || "USD", new Date().toISOString());
        if (decision) void recordDecision(decision);
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void recordDecision({ matchId: active.id, outcome: "rejected", invoiceIds: [], decidedAt: new Date().toISOString() });
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        const index = data.items.findIndex((match) => match.id === active.id);
        if (data.items[index + 1]) setActiveId(data.items[index + 1].id);
        else if (page < pages - 1) setPage((current) => current + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, data.items, decisions, invoiceById, page, pages, paymentById, recordDecision, savingId]);

  async function approveVisibleHighConfidence() {
    const pending = data.items.filter((match) => match.confidence === "high_confidence" && !decisions[match.id]);
    if (!pending.length) return;
    setBulkSaving(true);
    let saved = 0;
    for (const match of pending) {
      const decision = suggestedDecision(match, invoiceById, paymentById.get(match.paymentIds[0])?.currency || "USD", new Date().toISOString());
      if (decision && await recordDecision(decision, { advance: false, quiet: true })) saved += 1;
    }
    setBulkSaving(false);
    if (saved) toast.success(`${saved} visible high-confidence ${saved === 1 ? "match" : "matches"} confirmed`);
  }

  async function searchInvoices(query: string) {
    const params = new URLSearchParams({ workspaceId, type: "invoice", offset: "0", limit: "50", search: query, status: "open" });
    const response = await fetch(`/api/reconciliation/runs/latest/items?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("invoice search unavailable");
    const result = await response.json() as { items?: Invoice[] };
    if (!Array.isArray(result.items) || result.items.length > 50) throw new Error("invalid invoice search");
    return result.items;
  }

  return <div className="mx-auto max-w-[1460px]"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="eyebrow">Exception inbox</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Review payment matches</h1><p className="mt-2 text-sm text-muted">Search and page through the complete saved run without loading every financial record into the browser.</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={bulkSaving || savingId !== null} onClick={() => void approveVisibleHighConfidence()}><Check className="size-4" />{bulkSaving ? "Saving visible approvals" : "Approve visible high confidence"}</Button><div className="inline-flex items-center gap-2 border bg-surface px-3 text-xs text-muted"><Keyboard className="size-4" /><kbd>A</kbd> approve <kbd>R</kbd> reject <kbd>N</kbd> next</div></div></div>
    <div className="mt-6 grid min-h-[680px] border bg-surface xl:grid-cols-[390px_1fr]"><aside className="border-b xl:border-r xl:border-b-0"><div className="border-b p-3"><label className="relative block"><span className="sr-only">Search exception queue</span><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" /><input className="h-9 w-full border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand" placeholder="Search payer, memo, or invoice" value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label><div className="mt-2 grid grid-cols-4 gap-1" aria-label="Filter matches">{(["all", "review", "unmatched", "high"] as const).map((value) => <button key={value} type="button" onClick={() => { setFilter(value); setPage(0); }} className={cn("border px-2 py-2 text-xs font-semibold capitalize", filter === value ? "border-brand bg-brand-soft text-brand" : "bg-surface text-muted hover:text-foreground")}>{value}</button>)}</div></div>{loadError ? <p className="border-b bg-danger-soft p-3 text-xs text-danger" role="alert">This queue page could not be loaded. Try it again.</p> : null}<div className="max-h-[585px] overflow-y-auto" aria-busy={loading}>{data.items.length ? data.items.map((match) => { const payment = paymentById.get(match.paymentIds[0]); return <button data-testid="large-review-queue-item" key={match.id} type="button" onClick={() => setActiveId(match.id)} className={cn("block w-full border-b p-4 text-left transition hover:bg-surface-muted", active?.id === match.id ? "border-l-4 border-l-brand bg-brand-soft/60 pl-3" : "")}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{payment?.payerName || "Unknown payer"}</p><p className="mt-1 truncate font-mono text-[11px] text-muted">{payment?.description || "No payment memo"}</p></div><p className="numeric shrink-0 text-sm font-semibold">{money(match.paymentAmountMinor)}</p></div><div className="mt-3 flex items-center justify-between gap-3"><MatchStatus match={match} decision={decisions[match.id]} /><span className="text-xs text-muted">{payment ? shortDate(payment.paymentDate) : ""}</span></div></button>; }) : <div className="p-8 text-center"><Search className="mx-auto size-6 text-muted" /><p className="mt-3 text-sm font-semibold">No queue items found</p></div>}</div><div className="flex items-center justify-between gap-2 border-t p-3"><Button aria-label="Previous queue page" variant="quiet" size="sm" disabled={page === 0 || loading} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft className="size-4" /> Previous</Button><span className="text-center text-xs text-muted">Page {page + 1} of {pages}<span className="block">{data.total} results</span></span><Button aria-label="Next queue page" variant="quiet" size="sm" disabled={page >= pages - 1 || loading} onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}>Next <ChevronRight className="size-4" /></Button></div></aside>
      {active ? <MatchDetail key={active.id} match={active} payment={paymentById.get(active.paymentIds[0])} invoices={data.relatedInvoices} invoiceById={invoiceById} decision={decisions[active.id]} saving={savingId === active.id} onDecision={recordDecision} onInvoiceSearch={searchInvoices} /> : <div className="grid place-items-center p-8 text-center"><div><FileQuestion className="mx-auto size-8 text-muted" /><p className="mt-3 font-semibold">Select a match to review</p></div></div>}
    </div></div>;
}
