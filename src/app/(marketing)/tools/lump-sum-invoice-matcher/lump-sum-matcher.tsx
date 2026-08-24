"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { buttonVariants } from "@/components/ui/button";
import { findLumpSumCombinations, formatCents, parseAmountRows, parseCurrencyToCents } from "@/content/seo/tools";
import { fieldClass } from "../_components/tool-shell";

export function LumpSumMatcher() {
  const [payment, setPayment] = useState("4,725.00");
  const [invoices, setInvoices] = useState("INV-2108, 1500\nINV-2141, 1225\nINV-2190, 2000\nINV-2203, 750\nINV-2210, 6200");
  const [results, setResults] = useState<ReturnType<typeof findLumpSumCombinations> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const paymentCents = parseCurrencyToCents(payment);
    const parsed = parseAmountRows(invoices, "Invoice");
    const nextErrors = [...parsed.errors];
    if (paymentCents === null || paymentCents === 0) nextErrors.unshift("Enter a positive payment amount with no more than two decimal places.");
    if (parsed.rows.length > 20) nextErrors.push("This free browser tool accepts up to 20 valid invoice amounts at a time.");
    setErrors(nextErrors);
    if (nextErrors.length || paymentCents === null) {
      setResults(null);
      return;
    }
    setResults(findLumpSumCombinations(paymentCents, parsed.rows));
    sendAnalyticsEvent("lump_sum_tool_used", { tool: "lump_sum_matcher", result: "completed" });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <form className="border bg-surface p-6" onSubmit={handleSubmit} noValidate>
        <label className="block text-sm font-semibold" htmlFor="lump-payment">Payment amount</label>
        <div className="relative"><span className="pointer-events-none absolute left-3 top-[18px] text-sm text-muted">$</span><input className={`${fieldClass} pl-7 font-mono`} id="lump-payment" inputMode="decimal" value={payment} onChange={(event) => setPayment(event.target.value)} /></div>
        <label className="mt-6 block text-sm font-semibold" htmlFor="lump-invoices">Invoices, one per line</label>
        <p className="mt-1 text-xs leading-5 text-muted">Use <span className="font-mono">Invoice ID, amount</span> or only an amount. Maximum 20 invoices.</p>
        <textarea className={`${fieldClass} min-h-56 resize-y font-mono leading-6`} id="lump-invoices" value={invoices} onChange={(event) => setInvoices(event.target.value)} spellCheck={false} />
        {errors.length ? <div className="mt-4 border-l-2 border-danger bg-danger-soft px-4 py-3" role="alert"><p className="text-sm font-semibold text-danger">Check the input</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <button className={`${buttonVariants({ variant: "primary", size: "lg" })} mt-6 w-full`} type="submit"><Search className="size-4" />Find combinations</button>
      </form>
      <section className="border bg-surface" aria-live="polite" aria-labelledby="lump-results-title">
        <div className="border-b px-6 py-5"><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Result</p><h2 className="mt-1 text-xl font-semibold" id="lump-results-title">Possible invoice combinations</h2></div>
        <div className="p-6">
          {results === null ? <p className="max-w-lg text-sm leading-6 text-muted">Run the sample to see combinations. An exact total is a candidate only. Confirm customer, currency, date, references, and duplicate status before applying a payment.</p> : results.length === 0 ? <div><p className="font-semibold">No exact combination found within the limit.</p><p className="mt-2 text-sm leading-6 text-muted">Check for a partial payment, fee, deduction, credit, stale balance, or missing invoice. No values were changed.</p></div> : <div className="space-y-6"><p className="text-sm leading-6 text-muted">Found {results.length} exact {results.length === 1 ? "combination" : "combinations"}. Multiple results mean the amount is ambiguous.</p>{results.map((combination, index) => <div className="border" key={combination.map((item) => item.id).join("-")}><div className="flex items-center justify-between border-b bg-surface-muted px-4 py-3"><span className="text-sm font-semibold">Candidate {index + 1}</span><span className="font-mono text-sm font-semibold text-success">{formatCents(combination.reduce((sum, item) => sum + item.cents, 0))}</span></div><ul className="divide-y">{combination.map((invoice) => <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm" key={invoice.id}><span>{invoice.label}</span><span className="font-mono">{formatCents(invoice.cents)}</span></li>)}</ul></div>)}</div>}
        </div>
      </section>
    </div>
  );
}
