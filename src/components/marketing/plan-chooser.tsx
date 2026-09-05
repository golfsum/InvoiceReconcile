"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { recommendPlan } from "@/lib/billing/plan-recommendation";

export function PlanChooser() {
  const [payments, setPayments] = useState("50");
  const [workspaces, setWorkspaces] = useState("1");
  const [customRules, setCustomRules] = useState(false);
  const valid = /^\d+$/.test(payments) && /^\d+$/.test(workspaces) && Number(workspaces) >= 1;
  const plan = valid ? recommendPlan(Number(payments), Number(workspaces), customRules) : null;
  return (
    <section className="border-b bg-surface py-10" aria-labelledby="plan-chooser-heading">
      <div className="page-shell grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 id="plan-chooser-heading" className="text-2xl font-semibold tracking-tight">Find the smallest plan that fits.</h2>
          <p className="mt-3 text-sm leading-6 text-muted">Estimate monthly payments across all client workspaces. Start free to test your files before choosing a paid subscription.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Payments per month<input className="mt-2 min-h-11 w-full border bg-background px-3 font-mono" type="number" min="0" step="1" value={payments} onChange={(event) => setPayments(event.target.value)} /></label>
            <label className="text-sm font-medium">Client workspaces<input className="mt-2 min-h-11 w-full border bg-background px-3 font-mono" type="number" min="1" step="1" value={workspaces} onChange={(event) => setWorkspaces(event.target.value)} /></label>
          </div>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={customRules} onChange={(event) => setCustomRules(event.target.checked)} />I need custom matching rules or colleague invitations</label>
        </div>
        <div className="border bg-brand-soft p-6" aria-live="polite" aria-atomic="true">
          {!valid ? <p className="text-sm">Enter a whole number of payments (zero or more) and at least one workspace.</p> : plan ? <>
            <p className="eyebrow">Based on your needs</p><h3 className="mt-3 text-2xl font-semibold">{plan.name}: ${plan.price}/month</h3>
            <p className="mt-3 text-sm leading-6 text-muted-strong">Up to {plan.paymentLimit.toLocaleString("en-US")} payments per month. {plan.description}</p>
            <Link href={plan.key === "free" ? "/auth/sign-up" : `/auth/sign-up?plan=${plan.key}`} className={`${buttonVariants({ variant: "primary" })} mt-5`}>{plan.key === "free" ? "Start free, no card needed" : `Continue with ${plan.name}`}<ArrowRight className="size-4" /></Link>
            <p className="mt-3 text-xs leading-5 text-muted">{plan.key === "free" ? "Includes imports, matching, review, history, and exports." : "Choosing a plan does not charge a card. Review the subscription in checkout. Monthly renewal; cancel in billing settings. Taxes may apply."}</p>
          </> : <><h3 className="text-xl font-semibold">Your estimate exceeds our published plans.</h3><p className="mt-3 text-sm leading-6 text-muted-strong">The largest plan includes 10,000 payments per month and 20 workspaces. Confirm your requirements with us before subscribing.</p><a className="mt-4 inline-block font-semibold text-brand underline" href="mailto:support@invoicereconcile.com">Ask about your volume</a></>}
        </div>
      </div>
    </section>
  );
}
