"use client";

import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { findUniqueExactMatches, formatCents, parseAmountRows } from "@/content/seo/tools";
import { fieldClass } from "../_components/tool-shell";

type Result = ReturnType<typeof findUniqueExactMatches>;

export function InvoicePaymentMatcher() {
  const [invoices, setInvoices] = useState("INV-10487, 1250\nINV-10491, 800\nINV-10502, 800\nINV-10511, 2475");
  const [payments, setPayments] = useState("ACH-721, 1250\nWIRE-840, 800\nCHECK-118, 1900");
  const [result, setResult] = useState<Result | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function match(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invoiceRows = parseAmountRows(invoices, "Invoice");
    const paymentRows = parseAmountRows(payments, "Payment");
    const nextErrors = [...invoiceRows.errors.map((error) => `Invoices: ${error}`), ...paymentRows.errors.map((error) => `Payments: ${error}`)];
    if (invoiceRows.rows.length > 50 || paymentRows.rows.length > 50) nextErrors.push("This free tool accepts up to 50 valid rows in each list.");
    if (!invoiceRows.rows.length || !paymentRows.rows.length) nextErrors.push("Enter at least one valid invoice and one valid payment.");
    setErrors(nextErrors);
    setResult(nextErrors.length ? null : findUniqueExactMatches(invoiceRows.rows, paymentRows.rows));
  }

  return (
    <div>
      <form onSubmit={match} noValidate>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="border bg-surface p-5"><label className="text-sm font-semibold" htmlFor="match-invoices">Open invoices</label><p className="mt-1 text-xs text-muted">Invoice ID, amount</p><textarea className={`${fieldClass} min-h-56 resize-y font-mono leading-6`} id="match-invoices" value={invoices} onChange={(event) => setInvoices(event.target.value)} spellCheck={false} /></div>
          <div className="border bg-surface p-5"><label className="text-sm font-semibold" htmlFor="match-payments">Incoming payments</label><p className="mt-1 text-xs text-muted">Payment ID, amount</p><textarea className={`${fieldClass} min-h-56 resize-y font-mono leading-6`} id="match-payments" value={payments} onChange={(event) => setPayments(event.target.value)} spellCheck={false} /></div>
        </div>
        {errors.length ? <div className="mt-4 border-l-2 border-danger bg-danger-soft px-4 py-3" role="alert"><ul className="list-disc space-y-1 pl-5 text-sm text-danger">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <button className={`${buttonVariants({ variant: "primary", size: "lg" })} mt-5`} type="submit"><Search className="size-4" />Find unique exact amounts</button>
      </form>
      <section className="mt-8 border bg-surface" aria-live="polite" aria-labelledby="payment-match-results">
        <div className="border-b px-6 py-5"><h2 className="text-xl font-semibold" id="payment-match-results">Matching result</h2></div>
        <div className="p-6">
          {!result ? <p className="text-sm leading-6 text-muted">The tool only labels an exact amount when that amount appears once in each list. Repeated amounts remain ambiguous.</p> : <div className="grid gap-8 lg:grid-cols-3"><div><h3 className="font-semibold text-success">Unique exact amounts ({result.matches.length})</h3><div className="mt-4 divide-y border-y">{result.matches.length ? result.matches.map((match) => <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 text-sm" key={match.payment.id}><span>{match.payment.label}</span><ArrowRight className="size-4 text-success" /><span className="text-right">{match.invoice.label}<span className="block font-mono text-xs text-muted">{formatCents(match.invoice.cents)}</span></span></div>) : <p className="py-3 text-sm text-muted">None</p>}</div></div><div><h3 className="font-semibold text-warning">Ambiguous ({result.ambiguousPayments.length})</h3><ul className="mt-4 divide-y border-y">{result.ambiguousPayments.length ? result.ambiguousPayments.map((item) => <li className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.label}</span><span className="font-mono">{formatCents(item.cents)}</span></li>) : <li className="py-3 text-sm text-muted">None</li>}</ul></div><div><h3 className="font-semibold text-muted-strong">No exact amount ({result.unmatchedPayments.length})</h3><ul className="mt-4 divide-y border-y">{result.unmatchedPayments.length ? result.unmatchedPayments.map((item) => <li className="flex justify-between gap-3 py-3 text-sm" key={item.id}><span>{item.label}</span><span className="font-mono">{formatCents(item.cents)}</span></li>) : <li className="py-3 text-sm text-muted">None</li>}</ul></div></div>}
        </div>
      </section>
    </div>
  );
}
