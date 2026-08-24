"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { createWorkspaceAction } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { entitlementPlanName } from "@/lib/billing/entitlements";
import type { PaidPlanKey } from "@/lib/billing/catalog";

const input = "mt-1.5 min-h-11 w-full border bg-background px-3 font-normal outline-none focus:border-brand";

function CreateButton({ selectedPlan }: { selectedPlan?: PaidPlanKey }) { const { pending } = useFormStatus(); return <Button size="lg" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{pending ? "Creating workspace" : selectedPlan ? `Continue to ${entitlementPlanName(selectedPlan)} billing` : "Continue to imports"}</Button>; }

export function OnboardingForm({ selectedPlan }: { selectedPlan?: PaidPlanKey }) {
  const [state, action] = useActionState(createWorkspaceAction, {});
  return <form action={action} className="mt-8 grid gap-5">{selectedPlan ? <input type="hidden" name="selectedPlan" value={selectedPlan} /> : null}<label className="text-sm font-semibold">Business or firm name<input className={input} name="businessName" autoComplete="organization" required maxLength={200} /></label><fieldset><legend className="text-sm font-semibold">Account type</legend><div className="mt-2 grid gap-px border bg-border sm:grid-cols-3">{[["business", "Small business"], ["bookkeeping_firm", "Bookkeeping firm"], ["accounting_firm", "Accounting firm"]].map(([value, label], index) => <label className="flex cursor-pointer items-center gap-2 bg-surface p-3 text-sm" key={value}><input type="radio" name="organizationType" value={value} defaultChecked={index === 0} />{label}</label>)}</div></fieldset><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Currency<select className={input} name="currency" defaultValue="USD"><option>USD</option><option>CAD</option><option>EUR</option><option>GBP</option><option>AUD</option></select></label><label className="text-sm font-semibold">Timezone<select className={input} name="timezone" defaultValue="America/Phoenix"><option>America/Phoenix</option><option>America/Los_Angeles</option><option>America/Denver</option><option>America/Chicago</option><option>America/New_York</option><option>UTC</option></select></label><label className="text-sm font-semibold">Accounting basis<select className={input} name="accountingBasis" defaultValue="accrual"><option value="accrual">Accrual</option><option value="cash">Cash</option></select></label><label className="text-sm font-semibold">Default matching window<input className={input} name="matchDaysAfter" type="number" min="1" max="365" defaultValue="90" required /><span className="mt-1 block text-xs font-normal text-muted">Days after the invoice date.</span></label></div>{state.error ? <p className="border border-danger/25 bg-danger-soft p-3 text-sm text-danger" role="alert">{state.error}</p> : null}<div className="flex flex-col gap-3 sm:flex-row sm:items-center"><CreateButton selectedPlan={selectedPlan} /><Link className="text-sm font-semibold text-brand hover:underline" href="/app/demo">Use fictional sample data instead</Link></div></form>;
}
