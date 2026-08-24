"use client";

import { useState } from "react";
import { calculateManualReconciliationTime } from "@/content/seo/tools";
import { fieldClass } from "../_components/tool-shell";

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function TimeCalculator() {
  const [payments, setPayments] = useState(500);
  const [minutes, setMinutes] = useState(3);
  const [hourlyCost, setHourlyCost] = useState(35);
  const estimate = calculateManualReconciliationTime(payments, minutes, hourlyCost);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
      <form className="border bg-surface p-6" onSubmit={(event) => event.preventDefault()}>
        <label className="block text-sm font-semibold" htmlFor="time-payments">Payments per month</label><input className={fieldClass} id="time-payments" type="number" min="0" max="1000000" step="1" value={payments} onChange={(event) => setPayments(Math.max(0, Number(event.target.value) || 0))} />
        <label className="mt-6 block text-sm font-semibold" htmlFor="time-minutes">Average minutes per manual payment</label><input className={fieldClass} id="time-minutes" type="number" min="0" max="480" step="0.1" value={minutes} onChange={(event) => setMinutes(Math.max(0, Number(event.target.value) || 0))} />
        <label className="mt-6 block text-sm font-semibold" htmlFor="time-cost">Hourly bookkeeping cost</label><div className="relative"><span className="pointer-events-none absolute left-3 top-[18px] text-sm text-muted">$</span><input className={`${fieldClass} pl-7`} id="time-cost" type="number" min="0" max="10000" step="0.01" value={hourlyCost} onChange={(event) => setHourlyCost(Math.max(0, Number(event.target.value) || 0))} /></div>
        <p className="mt-5 text-xs leading-5 text-muted">Use a loaded hourly cost if available. This tool does not assume that every manual minute can be removed.</p>
      </form>
      <section className="border bg-surface" aria-live="polite" aria-labelledby="time-results">
        <div className="border-b px-6 py-5"><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Current manual process</p><h2 className="mt-1 text-xl font-semibold" id="time-results">Estimated effort</h2></div>
        <dl className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-6"><dt className="text-sm text-muted">Hours per month</dt><dd className="mt-2 text-3xl font-semibold numeric">{formatNumber(estimate.monthlyHours)}</dd></div>
          <div className="p-6"><dt className="text-sm text-muted">Labor cost per month</dt><dd className="mt-2 text-3xl font-semibold numeric">{formatMoney(estimate.monthlyLaborCost)}</dd></div>
          <div className="p-6"><dt className="text-sm text-muted">Labor cost per year</dt><dd className="mt-2 text-3xl font-semibold numeric">{formatMoney(estimate.annualLaborCost)}</dd></div>
        </dl>
        <div className="border-t bg-surface-muted px-6 py-5"><p className="font-mono text-sm">{formatNumber(payments, 0)} payments × {formatNumber(minutes)} minutes ÷ 60 = {formatNumber(estimate.monthlyHours)} hours/month</p><p className="mt-3 text-sm leading-6 text-muted">This is an estimate of the current manual workload, not a promised savings amount. Actual review time varies with file quality, exception rate, controls, and staff experience.</p></div>
      </section>
    </div>
  );
}
