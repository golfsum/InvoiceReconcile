"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { allocatePayment, formatCents, parseAmountRows, parseCurrencyToCents } from "@/content/seo/tools";
import { fieldClass } from "../_components/tool-shell";

type Allocation = ReturnType<typeof allocatePayment>;

export function PartialAllocationCalculator() {
  const [payment, setPayment] = useState("5,000.00");
  const [invoices, setInvoices] = useState("INV-301, 3000\nINV-305, 4000\nINV-309, 1200");
  const [result, setResult] = useState<Allocation | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseCurrencyToCents(payment);
    const rows = parseAmountRows(invoices, "Invoice");
    const nextErrors = [...rows.errors];
    if (cents === null || cents === 0) nextErrors.unshift("Enter a positive payment amount.");
    if (!rows.rows.length) nextErrors.push("Enter at least one valid invoice balance.");
    if (rows.rows.length > 30) nextErrors.push("This free calculator accepts up to 30 invoice balances.");
    setErrors(nextErrors);
    setResult(nextErrors.length || cents === null ? null : allocatePayment(cents, rows.rows));
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
      <form className="border bg-surface p-6" onSubmit={calculate} noValidate>
        <label className="block text-sm font-semibold" htmlFor="partial-payment">Payment to allocate</label><div className="relative"><span className="pointer-events-none absolute left-3 top-[18px] text-sm text-muted">$</span><input className={`${fieldClass} pl-7 font-mono`} id="partial-payment" inputMode="decimal" value={payment} onChange={(event) => setPayment(event.target.value)} /></div>
        <label className="mt-6 block text-sm font-semibold" htmlFor="partial-invoices">Invoice balances in allocation order</label><p className="mt-1 text-xs leading-5 text-muted">The calculator applies the payment from the first line down. Reorder the lines to test a different allocation.</p><textarea className={`${fieldClass} min-h-52 resize-y font-mono leading-6`} id="partial-invoices" value={invoices} onChange={(event) => setInvoices(event.target.value)} spellCheck={false} />
        {errors.length ? <div className="mt-4 border-l-2 border-danger bg-danger-soft px-4 py-3" role="alert"><ul className="list-disc space-y-1 pl-5 text-sm text-danger">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <button className={`${buttonVariants({ variant: "primary", size: "lg" })} mt-6 w-full`} type="submit"><ListChecks className="size-4" />Calculate allocation</button>
      </form>
      <section className="border bg-surface" aria-live="polite" aria-labelledby="allocation-results">
        <div className="border-b px-6 py-5"><h2 className="text-xl font-semibold" id="allocation-results">Proposed allocation</h2></div>
        <div className="p-6">
          {!result ? <p className="text-sm leading-6 text-muted">Run the sample to see applied and remaining amounts. This order-based calculation does not decide which invoices the customer intended to pay.</p> : <><div className="overflow-x-auto border"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-surface-muted"><tr><th className="border-b px-4 py-3">Invoice</th><th className="border-b px-4 py-3 text-right">Open</th><th className="border-b px-4 py-3 text-right">Applied</th><th className="border-b px-4 py-3 text-right">Remaining</th></tr></thead><tbody className="divide-y">{result.lines.map((line) => <tr key={line.id}><th scope="row" className="px-4 py-3 font-medium">{line.label}</th><td className="px-4 py-3 text-right font-mono">{formatCents(line.cents)}</td><td className="px-4 py-3 text-right font-mono text-success">{formatCents(line.appliedCents)}</td><td className="px-4 py-3 text-right font-mono">{formatCents(line.remainingCents)}</td></tr>)}</tbody></table></div><div className="mt-5 flex items-center justify-between border-l-2 border-brand bg-brand-soft px-4 py-3"><span className="text-sm font-semibold text-brand">Payment left unapplied</span><span className="font-mono font-semibold text-brand">{formatCents(result.unappliedCents)}</span></div><p className="mt-4 text-sm leading-6 text-muted">Confirm customer intent, invoice eligibility, currency, and accounting policy before using this allocation.</p></>}
        </div>
      </section>
    </div>
  );
}
