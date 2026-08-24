"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Invoice, Payment } from "@/lib/reconciliation";
import { money, shortDate } from "@/lib/demo/workspace";
import { StatusBadge } from "@/components/ui/status-badge";

const PAGE_SIZE = 12;
const LARGE_PAGE_SIZE = 50;

type RemotePage<T> = {
  offset: number;
  limit: number;
  total: number;
  items: T[];
};

function useRemoteRecords<T>(workspaceId: string, itemType: "invoice" | "payment", initialPage: RemotePage<T>) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const firstRequest = useRef(true);
  useEffect(() => {
    if (firstRequest.current && page === 0 && search === "" && status === "all") {
      firstRequest.current = false;
      return;
    }
    firstRequest.current = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      const query = new URLSearchParams({
        workspaceId,
        type: itemType,
        offset: String(page * LARGE_PAGE_SIZE),
        limit: String(LARGE_PAGE_SIZE),
        search,
        status,
      });
      void fetch(`/api/reconciliation/runs/latest/items?${query}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("page unavailable");
          const data = await response.json() as RemotePage<T>;
          if (!Array.isArray(data.items) || data.items.length > LARGE_PAGE_SIZE || !Number.isSafeInteger(data.total)) throw new Error("invalid page");
          setResult(data);
        })
        .catch(() => { if (!controller.signal.aborted) setError(true); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search ? 250 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [itemType, page, search, status, workspaceId]);
  return {
    search,
    setSearch: (value: string) => { setSearch(value); setPage(0); },
    status,
    setStatus: (value: string) => { setStatus(value); setPage(0); },
    page,
    setPage,
    result,
    loading,
    error,
  };
}

export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => invoices.filter((invoice) => {
    const statusMatch = status === "all" || invoice.status === status;
    const text = `${invoice.invoiceNumber} ${invoice.customerName} ${invoice.reference || ""}`.toLowerCase();
    return statusMatch && text.includes(search.toLowerCase());
  }), [invoices, search, status]);
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return <RecordsFrame title="Invoices" count={filtered.length} search={search} setSearch={(value) => { setSearch(value); setPage(0); }} filter={status} setFilter={(value) => { setStatus(value); setPage(0); }} options={[["all", "All statuses"], ["open", "Open"], ["partially_paid", "Partially paid"], ["paid", "Paid"]]} page={page} setPage={setPage} pages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}>
    <table className="w-full min-w-[860px] text-left text-sm"><thead className="border-y bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Invoice date</th><th className="px-5 py-3">Due</th><th className="px-5 py-3 text-right">Original</th><th className="px-5 py-3 text-right">Outstanding</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">{rows.map((invoice) => <tr key={invoice.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-mono text-xs font-semibold">{invoice.invoiceNumber}</td><td className="px-5 py-4 font-semibold">{invoice.customerName}</td><td className="px-5 py-4 text-muted">{shortDate(invoice.invoiceDate)}</td><td className="px-5 py-4 text-muted">{invoice.dueDate ? shortDate(invoice.dueDate) : "Not set"}</td><td className="numeric px-5 py-4 text-right">{money(invoice.originalAmountMinor, invoice.currency)}</td><td className="numeric px-5 py-4 text-right font-semibold">{money(invoice.outstandingAmountMinor, invoice.currency)}</td><td className="px-5 py-4"><StatusBadge status={invoice.status === "paid" ? "exact" : invoice.status === "partially_paid" ? "review" : "unmatched"} label={invoice.status.replaceAll("_", " ")} /></td></tr>)}</tbody></table>
  </RecordsFrame>;
}

export function PaymentTable({ payments }: { payments: Payment[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => payments.filter((payment) => `${payment.payerName || ""} ${payment.description || ""} ${payment.transactionId || ""}`.toLowerCase().includes(search.toLowerCase())), [payments, search]);
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return <RecordsFrame title="Payments" count={filtered.length} search={search} setSearch={(value) => { setSearch(value); setPage(0); }} page={page} setPage={setPage} pages={Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}>
    <table className="w-full min-w-[850px] text-left text-sm"><thead className="border-y bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Payer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Transaction</th><th className="px-5 py-3">Account</th></tr></thead><tbody className="divide-y">{rows.map((payment) => <tr key={payment.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-semibold">{payment.payerName || "Unknown payer"}</td><td className="px-5 py-4 text-muted">{shortDate(payment.paymentDate)}</td><td className="numeric px-5 py-4 text-right font-semibold">{money(payment.amountMinor, payment.currency)}</td><td className="max-w-xs truncate px-5 py-4 font-mono text-xs text-muted">{payment.description || "No description"}</td><td className="px-5 py-4 font-mono text-xs">{payment.transactionId || "Not provided"}</td><td className="px-5 py-4 text-muted">{payment.accountId || "Default"}</td></tr>)}</tbody></table>
  </RecordsFrame>;
}

export function LargeInvoiceTable({ workspaceId, initialPage }: { workspaceId: string; initialPage: RemotePage<Invoice> }) {
  const state = useRemoteRecords(workspaceId, "invoice", initialPage);
  const pages = Math.max(1, Math.ceil(state.result.total / LARGE_PAGE_SIZE));
  return <RecordsFrame title="Invoices" count={state.result.total} search={state.search} setSearch={state.setSearch} filter={state.status} setFilter={state.setStatus} options={[["all", "All statuses"], ["open", "Open"], ["partially_paid", "Partially paid"], ["paid", "Paid"]]} page={state.page} setPage={state.setPage} pages={pages}>
    {state.error ? <p className="border-b bg-danger-soft p-4 text-sm text-danger" role="alert">This page could not be loaded. Try it again.</p> : null}
    <table className="w-full min-w-[860px] text-left text-sm" aria-busy={state.loading}><thead className="border-y bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Invoice date</th><th className="px-5 py-3">Due</th><th className="px-5 py-3 text-right">Original</th><th className="px-5 py-3 text-right">Outstanding</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">{state.result.items.map((invoice) => <tr key={invoice.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-mono text-xs font-semibold">{invoice.invoiceNumber}</td><td className="px-5 py-4 font-semibold">{invoice.customerName}</td><td className="px-5 py-4 text-muted">{shortDate(invoice.invoiceDate)}</td><td className="px-5 py-4 text-muted">{invoice.dueDate ? shortDate(invoice.dueDate) : "Not set"}</td><td className="numeric px-5 py-4 text-right">{money(invoice.originalAmountMinor, invoice.currency)}</td><td className="numeric px-5 py-4 text-right font-semibold">{money(invoice.outstandingAmountMinor, invoice.currency)}</td><td className="px-5 py-4"><StatusBadge status={invoice.status === "paid" ? "exact" : invoice.status === "partially_paid" ? "review" : "unmatched"} label={invoice.status.replaceAll("_", " ")} /></td></tr>)}</tbody></table>
  </RecordsFrame>;
}

export function LargePaymentTable({ workspaceId, initialPage }: { workspaceId: string; initialPage: RemotePage<Payment> }) {
  const state = useRemoteRecords(workspaceId, "payment", initialPage);
  const pages = Math.max(1, Math.ceil(state.result.total / LARGE_PAGE_SIZE));
  return <RecordsFrame title="Payments" count={state.result.total} search={state.search} setSearch={state.setSearch} page={state.page} setPage={state.setPage} pages={pages}>
    {state.error ? <p className="border-b bg-danger-soft p-4 text-sm text-danger" role="alert">This page could not be loaded. Try it again.</p> : null}
    <table className="w-full min-w-[850px] text-left text-sm" aria-busy={state.loading}><thead className="border-y bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Payer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Transaction</th><th className="px-5 py-3">Account</th></tr></thead><tbody className="divide-y">{state.result.items.map((payment) => <tr key={payment.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-semibold">{payment.payerName || "Unknown payer"}</td><td className="px-5 py-4 text-muted">{shortDate(payment.paymentDate)}</td><td className="numeric px-5 py-4 text-right font-semibold">{money(payment.amountMinor, payment.currency)}</td><td className="max-w-xs truncate px-5 py-4 font-mono text-xs text-muted">{payment.description || "No description"}</td><td className="px-5 py-4 font-mono text-xs">{payment.transactionId || "Not provided"}</td><td className="px-5 py-4 text-muted">{payment.accountId || "Default"}</td></tr>)}</tbody></table>
  </RecordsFrame>;
}

function RecordsFrame({ title, count, search, setSearch, filter, setFilter, options, page, setPage, pages, children }: { title: string; count: number; search: string; setSearch: (value: string) => void; filter?: string; setFilter?: (value: string) => void; options?: string[][]; page: number; setPage: (value: number) => void; pages: number; children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1260px]"><div><p className="eyebrow">Records</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{title}</h1><p className="mt-2 text-sm text-muted">Original source values stay available beside normalized records.</p></div><section className="mt-6 border bg-surface"><div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-1 flex-col gap-2 sm:flex-row"><label className="relative block max-w-sm flex-1"><span className="sr-only">Search {title.toLowerCase()}</span><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted" /><input className="h-9 w-full border bg-background pl-9 pr-3 text-sm outline-none focus:border-brand" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} /></label>{filter !== undefined && setFilter && options ? <select className="h-9 border bg-background px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : null}</div><span className="text-xs font-semibold text-muted">{count} records</span></div><div className="overflow-x-auto">{children}</div><div className="flex items-center justify-between border-t p-4"><p className="text-xs text-muted">Page {page + 1} of {pages}</p><div className="flex gap-2"><button type="button" className="inline-flex size-8 items-center justify-center border disabled:opacity-40" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))} aria-label="Previous page"><ChevronLeft className="size-4" /></button><button type="button" className="inline-flex size-8 items-center justify-center border disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(Math.min(pages - 1, page + 1))} aria-label="Next page"><ChevronRight className="size-4" /></button></div></div></section></div>;
}
