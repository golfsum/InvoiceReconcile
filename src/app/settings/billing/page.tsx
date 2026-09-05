import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { CheckoutButton, PortalButton } from "@/components/billing/billing-actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/auth/access";
import { isBillingConfigured } from "@/lib/billing/catalog";
import { selectedOrganizationId, selectedPaidPlan } from "@/lib/billing/intent";
import { loadBillingSummary } from "@/lib/billing/summary";
import { plans } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing settings", robots: { index: false, follow: false } };

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/settings/billing");
  const query = await searchParams;
  const selectedPlan = selectedPaidPlan(query.plan);
  const requestedOrganizationId = selectedOrganizationId(query.organizationId) || undefined;
  const billing = await loadBillingSummary(user, requestedOrganizationId);
  const organizationId = billing.ok ? billing.organizationId : requestedOrganizationId;
  const canCheckout = billing.ok && !billing.hasSubscription;
  const periodEnd = billing.ok && billing.periodEndsAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(billing.periodEndsAt))
    : null;
  const billingMessage = !billing.ok
    ? billing.code === "organization_required"
      ? "Choose a workspace, then open billing from its Settings to select the right organization."
      : billing.code === "billing_admin_required"
        ? "Only an organization owner or admin can view and manage billing."
        : "Billing status could not be loaded. Refresh this page, or contact support@invoicereconcile.com."
    : null;
  const selectedPlanDetails = selectedPlan ? plans.find((plan) => plan.key === selectedPlan) : undefined;
  const billingConfigured = isBillingConfigured();
  const checkoutState = query.checkout === "success" || query.checkout === "canceled"
    ? query.checkout
    : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-surface">
        <div className="page-shell flex h-16 items-center justify-between">
          <BrandLogo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link className="border px-3 py-2 text-sm font-semibold" href="/app">Back to app</Link>
          </div>
        </div>
      </header>
      <main className="page-shell py-10">
        <p className="eyebrow">Account settings</p>
        {checkoutState ? (
          <div
            className={`mt-4 border p-4 text-sm leading-6 ${checkoutState === "success" ? "border-brand/25 bg-brand-soft text-muted-strong" : "border-warning/25 bg-warning-soft text-muted-strong"}`}
            role="status"
          >
            {checkoutState === "success"
              ? billing.ok && billing.hasSubscription && ["active", "trialing"].includes(billing.status)
                ? `Your ${billing.plan.name} subscription is confirmed. Your plan features are available in the app.`
                : "Checkout returned successfully. Check the saved billing status below; if it is still pending, refresh in a moment."
              : "Checkout was canceled. No subscription change was submitted. Choosing the same plan reopens its secure session until it expires."}
          </div>
        ) : null}
        <div className="mt-3 flex flex-col gap-4 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em]">Plan and billing</h1>
            <p className="mt-2 text-sm text-muted">Signed in as {user.email}. Stripe hosts card entry, invoices, and subscription changes.</p>
          </div>
          {billing.ok && billing.hasBillingAccount ? <PortalButton organizationId={organizationId} /> : null}
        </div>

        <section className="mt-6 border bg-surface p-5" aria-label="Current billing status">
          {billing.ok ? (
            <>
              <h2 className="text-xl font-semibold">Current plan: {billing.plan.name}</h2>
              <p className="mt-2 text-sm text-muted-strong">{billing.plan.paymentLimit.toLocaleString()} payments per month. Status: {billing.status.replaceAll("_", " ")}.</p>
              {billing.status === "past_due" ? <p className="mt-2 text-sm text-warning">Payment needs attention. Paid access remains available during the payment-recovery grace period. Update your payment method in Manage subscription.</p> : null}
              {["unpaid", "incomplete", "paused"].includes(billing.status) ? <p className="mt-2 text-sm text-warning">Paid access is not active. Use Manage subscription to resolve your billing status.</p> : null}
              {billing.cancelAtPeriodEnd && periodEnd ? <p className="mt-2 text-sm text-muted-strong">Cancellation scheduled. Paid access ends {periodEnd} (UTC).</p>
                : billing.hasSubscription && periodEnd ? <p className="mt-2 text-sm text-muted">Current billing period ends {periodEnd} (UTC).</p> : null}
            </>
          ) : <p className="text-sm text-warning">{billingMessage}</p>}
          <a className="mt-3 inline-block text-sm font-semibold underline" href={`/settings/billing${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`}>Refresh billing status</a>
        </section>

        {canCheckout && selectedPlan && selectedPlanDetails ? (
          <section className="mt-8 grid gap-5 border border-brand bg-brand-soft p-5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-semibold text-brand">{selectedPlanDetails.name} selected</p>
              <h2 className="mt-1 text-xl font-semibold">Your workspace is ready. Continue to secure checkout.</h2>
              <p className="mt-2 text-sm text-muted-strong">${selectedPlanDetails.price}/month for up to {selectedPlanDetails.paymentLimit.toLocaleString()} payments each month. Stripe will show the recurring charge before payment.</p>
            </div>
            <div className="min-w-56">
              <CheckoutButton organizationId={organizationId} plan={selectedPlan} label={`Continue with ${selectedPlanDetails.name}`} />
            </div>
          </section>
        ) : null}

        <div className="mt-8 grid gap-px border bg-border md:grid-cols-3">
          {plans.filter((plan) => plan.key !== "free").map((plan) => (
            <section className="bg-surface p-6" key={plan.key}>
              <h2 className="font-semibold">{plan.name}</h2>
              <p className="numeric mt-4 text-3xl font-semibold">${plan.price}<span className="text-sm font-normal text-muted">/month</span></p>
              <p className="mt-3 min-h-14 text-sm leading-6 text-muted">{plan.description}</p>
              {canCheckout ? <CheckoutButton organizationId={organizationId} plan={plan.key} label={`Choose ${plan.name}`} />
                : billing.ok && billing.hasSubscription ? <p className="text-sm font-semibold">{billing.plan.key === plan.key ? "Your current plan" : "Change plans in Manage subscription"}</p> : null}
            </section>
          ))}
        </div>

        {!billingConfigured ? (
          <div className="mt-8 border border-warning/25 bg-warning-soft p-4 text-sm leading-6 text-muted-strong">
            <strong className="text-warning">Billing setup needed:</strong> configure the Stripe API keys, recurring price IDs, and webhook secret. Until then, checkout returns a safe unavailable response and does not create a charge.
          </div>
        ) : null}
      </main>
    </div>
  );
}
