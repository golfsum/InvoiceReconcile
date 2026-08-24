"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowRight, LoaderCircle } from "lucide-react";
import { requestPasswordResetAction, signInAction, signUpAction, updatePasswordAction, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import { readAnalyticsAttribution } from "@/lib/analytics/client";
import { entitlementPlanName } from "@/lib/billing/entitlements";
import type { PaidPlanKey } from "@/lib/billing/catalog";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button className="w-full" size="lg" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{pending ? "Working" : label}</Button>;
}

function Feedback({ state }: { state: AuthState }) {
  if (!state.error && !state.message) return null;
  return <div role={state.error ? "alert" : "status"} className={`flex gap-3 border p-3 text-sm ${state.error ? "border-danger/25 bg-danger-soft text-danger" : "border-success/25 bg-success-soft text-success"}`}><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>{state.error || state.message}</p></div>;
}

const inputClass = "mt-1.5 min-h-11 w-full border bg-background px-3 text-sm outline-none transition placeholder:text-muted focus:border-brand";

export function SignInForm({ returnTo = "/app" }: { returnTo?: string }) {
  const [state, action] = useActionState(signInAction, {});
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="block text-sm font-semibold">Email<input className={inputClass} type="email" name="email" autoComplete="email" required /></label>
        <label className="block text-sm font-semibold">Password<input className={inputClass} type="password" name="password" autoComplete="current-password" minLength={8} required /></label>
        <div className="flex justify-end"><Link href="/auth/forgot-password" className="text-sm font-semibold text-brand hover:underline">Forgot password?</Link></div>
        <Feedback state={state} />
        <SubmitButton label="Sign in" />
      </form>
      <DemoEntry />
      <p className="text-center text-sm text-muted">New to InvoiceReconcile? <Link className="font-semibold text-foreground hover:underline" href={returnTo === "/app" ? "/auth/sign-up" : `/auth/sign-up?returnTo=${encodeURIComponent(returnTo)}${returnTo === "/auth/accept-invite" ? "&source=referral" : ""}`}>Create an account</Link></p>
    </div>
  );
}

export function SignUpForm({ selectedPlan, returnTo, signupSource }: { selectedPlan?: PaidPlanKey; returnTo?: string; signupSource?: string }) {
  const [state, action] = useActionState(signUpAction, {});
  const signupSourceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (signupSourceRef.current) signupSourceRef.current.value = signupSource || readAnalyticsAttribution().signupSource;
    sendAnalyticsEvent("signup_started", { cta: "in_app" });
  }, [signupSource]);
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input ref={signupSourceRef} type="hidden" name="signupSource" defaultValue={signupSource || "unattributed"} />
        {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
        {selectedPlan ? <input type="hidden" name="plan" value={selectedPlan} /> : null}
        {selectedPlan ? <p className="border border-brand/25 bg-brand-soft p-3 text-sm text-muted-strong"><strong className="text-foreground">{entitlementPlanName(selectedPlan)} selected.</strong> Create the workspace first, then continue to secure Stripe Checkout.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Your name<input className={inputClass} name="fullName" autoComplete="name" required /></label>
          <label className="block text-sm font-semibold">Business or firm<input className={inputClass} name="businessName" autoComplete="organization" required /></label>
        </div>
        <label className="block text-sm font-semibold">Business email<input className={inputClass} type="email" name="email" autoComplete="email" required /></label>
        <label className="block text-sm font-semibold">Password<input className={inputClass} type="password" name="password" autoComplete="new-password" minLength={8} required /><span className="mt-1.5 block text-xs font-normal text-muted">Use at least 8 characters.</span></label>
        <Feedback state={state} />
        <SubmitButton label={selectedPlan ? `Create account for ${entitlementPlanName(selectedPlan)}` : "Create free account"} />
      </form>
      <DemoEntry />
      <p className="text-center text-sm text-muted">Already have an account? <Link className="font-semibold text-foreground hover:underline" href="/auth/sign-in">Sign in</Link></p>
    </div>
  );
}

function DemoEntry() {
  return (
    <div className="relative pt-2">
      <div className="absolute inset-x-0 top-5 border-t" /><span className="relative mx-auto block w-fit bg-surface px-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">or</span>
      <form action="/api/demo/session" method="post" className="mt-4"><input type="hidden" name="returnTo" value="/app/demo" /><Button type="submit" variant="secondary" size="lg" className="w-full">Open fictional sample workspace</Button></form>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {});
  return <form action={action} className="space-y-4"><label className="block text-sm font-semibold">Account email<input className={inputClass} type="email" name="email" autoComplete="email" required /></label><Feedback state={state} /><SubmitButton label="Send reset link" /><p className="text-center text-sm text-muted"><Link className="font-semibold text-foreground hover:underline" href="/auth/sign-in">Return to sign in</Link></p></form>;
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, {});
  return <form action={action} className="space-y-4"><label className="block text-sm font-semibold">New password<input className={inputClass} type="password" name="password" autoComplete="new-password" minLength={8} required /></label><label className="block text-sm font-semibold">Confirm new password<input className={inputClass} type="password" name="confirmation" autoComplete="new-password" minLength={8} required /></label><Feedback state={state} /><SubmitButton label="Update password" />{state.message ? <Link className="block text-center text-sm font-semibold text-brand hover:underline" href="/app">Continue to the app</Link> : null}</form>;
}
