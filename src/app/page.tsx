import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  Check,
  CircleDollarSign,
  KeyRound,
  ListChecks,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  Split,
  Users,
} from "lucide-react";
import { MarketingFrame } from "@/components/marketing/marketing-frame";
import { NarratedDemo } from "@/components/marketing/narrated-demo";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { canonicalMetadata, JsonLd } from "@/content/seo/seo-components";
import { northstarInvoices, northstarPayments } from "@/lib/reconciliation/fixtures/northstar";
import { plans, siteConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = canonicalMetadata(
  "Invoice Reconciliation Software for Bookkeepers",
  "Match CSV and Excel payments to invoices, including lump sums, partials and fees. Review the evidence and export results. Start free with 50 payments per month.",
  "/",
);

const hardCases = [
  { icon: Split, title: "One payment, several invoices", copy: "Narrow by payer, date, currency, and reference before testing plausible invoice combinations." },
  { icon: CircleDollarSign, title: "Partial and excess payments", copy: "Apply the received amount, preserve the remaining balance, and keep overpayments visible." },
  { icon: ScanSearch, title: "Names and references that drift", copy: "Compare normalized payer names and invoice references without hiding the original bank memo." },
  { icon: ListChecks, title: "Fees and deductions", copy: "Show the exact difference and require a person to identify the reason before it is recorded." },
];

const audiences = [
  { icon: BookOpenCheck, title: "Bookkeepers", href: "/solutions/bookkeepers", copy: "Move across client workspaces from one portfolio view while keeping imported records and decisions separate." },
  { icon: Building2, title: "Accounting firms", href: "/solutions/accounting-firms", copy: "See what is ready, what is waiting, and who made each reconciliation decision across the firm." },
  { icon: Users, title: "Small finance teams", href: "/solutions/small-business", copy: "Replace repeated spreadsheet lookups with a traceable import, review, confirm, and export workflow." },
];

function HeroLedger() {
  return (
    <div className="relative border bg-surface shadow-panel">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <p className="text-xs font-semibold text-muted">Northstar Services · Fictional sample</p>
          <p className="mt-0.5 text-sm font-semibold">Today&apos;s reconciliation</p>
        </div>
        <span className="border border-success/20 bg-success-soft px-2 py-1 text-xs font-bold text-success">Try it yourself</span>
      </div>
      <div className="grid grid-cols-2 border-b sm:grid-cols-4">
        {[["Invoices", String(northstarInvoices.length)], ["Payment rows", String(northstarPayments.length)], ["Currency", "USD"], ["Data", "Sample"]].map(([label, value], index) => (
          <div key={label} className={cn("p-4", index < 3 ? "sm:border-r" : "", index < 2 ? "border-b sm:border-b-0" : "")}>
            <p className="text-xs text-muted">{label}</p>
            <p className="numeric mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.09em] text-muted">A case in the demo</p><p className="mt-2 text-sm font-semibold">Suncrest Architecture</p></div>
          <p className="numeric text-lg font-semibold">$4,850.00</p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-y py-3 text-sm">
          <span className="font-mono text-xs">NS-2026-1009</span><span className="numeric font-semibold">$5,000.00</span>
        </div>
        <div className="mt-4 flex items-start gap-3 bg-warning-soft p-3 text-warning">
          <ScanSearch className="mt-0.5 size-4 shrink-0" />
          <div><p className="text-sm font-semibold">Review $150.00 difference</p><p className="mt-1 text-xs leading-5 text-muted-strong">Possible fee or deduction. No reason has been assumed.</p></div>
        </div>
        <Link href="/app/demo/exceptions" className={cn(buttonVariants({ variant: "primary" }), "mt-5 w-full")}>Explore the sample exceptions</Link>
        <p className="mt-3 text-center text-xs leading-5 text-muted">Fictional data. No signup or bank connection needed.</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <MarketingFrame>
      <JsonLd value={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteConfig.name,
        url: siteConfig.url,
        logo: new URL("/icon.svg", siteConfig.url).toString(),
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: siteConfig.supportEmail,
        },
      }} />
      <section className="relative overflow-hidden border-b py-16 sm:py-24 lg:py-28">
        <div className="hairline-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="page-shell relative grid gap-12 lg:grid-cols-[1.04fr_0.96fr] lg:items-center">
          <div>
            <p className="eyebrow">Invoice reconciliation software for bookkeepers</p>
            <h1 className="mt-5 max-w-3xl text-balance text-[2.7rem] font-semibold leading-[1.03] tracking-[-0.055em] sm:text-6xl lg:text-[4.2rem]">Stop matching invoice payments by hand.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-strong sm:text-xl">Turn invoice and bank exports into suggested matches, a clear exception list, and a reviewable record. Handle combined payments, partials, and fees without replacing your accounting software.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/auth/sign-up" className={buttonVariants({ variant: "primary", size: "lg" })}>Reconcile 50 payments free <ArrowRight className="size-4" /></Link>
              <Link href="/app/demo" className={buttonVariants({ variant: "secondary", size: "lg" })}>Try it without signing up</Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-2"><Check className="size-4 text-success" /> No credit card required</span>
              <span className="inline-flex items-center gap-2"><Check className="size-4 text-success" /> 50 payments every month</span>
              <span className="inline-flex items-center gap-2"><Check className="size-4 text-success" /> You confirm every result</span>
            </div>
          </div>
          <HeroLedger />
        </div>
      </section>

      <section className="border-b bg-surface py-8" aria-label="Works with your existing exports">
        <div className="page-shell grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div><h2 className="font-semibold">Keep your accounting system. Lose the repeated lookups.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Upload CSV or XLSX invoice and payment exports from your existing tools. No live QuickBooks, Xero, or bank connection is required. Nothing posts back automatically.</p></div>
          <Link href="/excel-invoice-reconciliation" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">See the file format and free samples <ArrowRight className="size-4" /></Link>
        </div>
      </section>

      <NarratedDemo />

      <section className="py-18 sm:py-24">
        <div className="page-shell grid gap-10 lg:grid-cols-[0.82fr_1.18fr]">
          <div><p className="eyebrow">The manual problem</p><h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">The clean matches are not where the day goes.</h2></div>
          <div className="grid gap-6 text-base leading-7 text-muted-strong sm:grid-cols-2">
            <p>One ACH covers three invoices. A card settlement arrives net of a fee. The bank memo uses the parent company name. Each exception sends a bookkeeper back through invoices, exports, and notes.</p>
            <p>InvoiceReconcile applies traceable rules first, separates strong matches from uncertain ones, and keeps the original evidence beside the suggested application.</p>
          </div>
        </div>
      </section>

      <section className="border-y bg-surface py-18 sm:py-24">
        <div className="page-shell">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Import, match, review, confirm, export.</h2>
          <ol className="mt-10 grid gap-px border bg-border md:grid-cols-5">
            {[
              ["01", "Import invoices", "Upload a CSV or XLSX file and confirm the detected columns."],
              ["02", "Import payments", "Add a bank, ACH, wire, or processor export."],
              ["03", "Run matching", "Score amount, reference, payer, date, and currency with traceable rules."],
              ["04", "Review exceptions", "Approve, split, reassign, record a difference, or leave unmatched."],
              ["05", "Export the record", "Download confirmed matches, discrepancies, and the audit history."],
            ].map(([number, title, copy]) => (
              <li key={number} className="bg-surface p-5 sm:p-6"><span className="font-mono text-xs font-bold text-brand">{number}</span><h3 className="mt-8 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{copy}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-18 sm:py-24">
        <div className="page-shell">
          <div className="max-w-2xl"><p className="eyebrow">Difficult cases</p><h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Built for the payments that do not match cleanly.</h2></div>
          <div className="mt-10 grid border-y md:grid-cols-2">
            {hardCases.map((item, index) => (
              <article key={item.title} className={cn("py-7 md:p-8", index % 2 === 0 ? "md:border-r" : "", index < 2 ? "border-b" : "")}>
                <item.icon className="size-5 text-brand" /><h3 className="mt-6 text-lg font-semibold">{item.title}</h3><p className="mt-2 max-w-lg text-sm leading-6 text-muted">{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-[#eff2ed] py-18 text-[#17201d] dark:bg-[#18201d] dark:text-[#edf1ee] sm:py-24">
        <div className="page-shell grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
          <div><p className="eyebrow">Exception inbox</p><h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Start with the decisions that need you.</h2><p className="mt-4 text-base leading-7 text-muted-strong">Successful matches stay available in the audit trail. The working queue prioritizes discrepancies, ambiguity, and unmatched payments.</p><Link href="/app/demo/exceptions" className={cn(buttonVariants({ variant: "primary" }), "mt-7")}>Open the demo inbox <ArrowRight className="size-4" /></Link></div>
          <div className="overflow-x-auto border bg-surface shadow-panel" tabIndex={0} aria-label="Scrollable example reconciliation exceptions table">
            <table className="w-full min-w-[650px] text-left text-sm">
              <caption className="sr-only">Example reconciliation exceptions</caption>
              <thead className="border-b bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Suggested</th><th className="px-4 py-3">Difference</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y">
                <tr><td className="px-4 py-4"><strong>Suncrest Architecture</strong><span className="mt-1 block text-xs text-muted">$4,850.00 · Jul 1</span></td><td className="px-4 py-4 font-mono text-xs">NS-2026-1009</td><td className="numeric px-4 py-4 text-warning">-$150.00</td><td className="px-4 py-4"><StatusBadge status="review" /></td></tr>
                <tr><td className="px-4 py-4"><strong>Copper State Legal</strong><span className="mt-1 block text-xs text-muted">$2,500.00 · Jun 29</span></td><td className="px-4 py-4 font-mono text-xs">NS-2026-1007</td><td className="numeric px-4 py-4">Partial</td><td className="px-4 py-4"><StatusBadge status="review" label="Partial" /></td></tr>
                <tr><td className="px-4 py-4"><strong>Redwood Community Arts</strong><span className="mt-1 block text-xs text-muted">$535.00 · Jul 7</span></td><td className="px-4 py-4 text-muted">No responsible match</td><td className="numeric px-4 py-4">$535.00</td><td className="px-4 py-4"><StatusBadge status="unmatched" /></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="py-18 sm:py-24">
        <div className="page-shell"><p className="eyebrow">Who it is for</p><div className="mt-8 grid gap-8 lg:grid-cols-3">
          {audiences.map((item) => <article key={item.title} className="border-t-2 border-foreground pt-6"><item.icon className="size-5 text-brand" /><h2 className="mt-7 text-xl font-semibold">{item.title}</h2><p className="mt-3 text-sm leading-6 text-muted">{item.copy}</p><Link href={item.href} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">Explore the workflow <ArrowRight className="size-4" /></Link></article>)}
        </div></div>
      </section>

      <section className="border-y bg-surface py-18 sm:py-24">
        <div className="page-shell grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div><p className="eyebrow">Control and security</p><h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">A suggestion is not a posting.</h2><p className="mt-4 max-w-xl text-base leading-7 text-muted-strong">InvoiceReconcile keeps automated reasoning visible and leaves financial changes under human control. Confirmed results are exported only when you choose.</p><Link href="/security" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">Read the security approach <ArrowRight className="size-4" /></Link></div>
          <ul className="divide-y border-y">
            <li className="flex gap-4 py-5"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-brand" /><div><h3 className="font-semibold">Tenant isolation</h3><p className="mt-1 text-sm leading-6 text-muted">Workspace access is checked on the server and enforced with database row-level security.</p></div></li>
            <li className="flex gap-4 py-5"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" /><div><h3 className="font-semibold">Controlled file processing</h3><p className="mt-1 text-sm leading-6 text-muted">Your uploaded files are private. Original upload files are held temporarily for processing, then cleaned up; structured records and review history remain available.</p></div></li>
            <li className="flex gap-4 py-5"><KeyRound className="mt-0.5 size-5 shrink-0 text-brand" /><div><h3 className="font-semibold">Traceable decisions</h3><p className="mt-1 text-sm leading-6 text-muted">Every match keeps its method, evidence, source import, prior state, new state, timestamp, and user.</p></div></li>
          </ul>
        </div>
      </section>

      <section className="py-18 sm:py-24" id="pricing">
        <div className="page-shell">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Pricing</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Start with one real file.</h2></div><Link href="/pricing" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">Compare plan details <ArrowRight className="size-4" /></Link></div>
          <div className="mt-10 grid gap-px border bg-border md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <article key={plan.key} className={cn("relative bg-surface p-6", "highlighted" in plan && plan.highlighted ? "ring-2 ring-inset ring-brand" : "")}>
                {"highlighted" in plan && plan.highlighted ? <span className="absolute right-4 top-4 bg-brand-soft px-2 py-1 text-xs font-bold text-brand">For teams</span> : null}
                <h3 className="font-semibold">{plan.name}</h3><p className="numeric mt-5 text-3xl font-semibold tracking-tight">${plan.price}<span className="text-sm font-normal text-muted">/month</span></p><p className="mt-3 min-h-12 text-sm leading-6 text-muted">{plan.description}</p><p className="mt-5 border-t pt-4 text-xs font-semibold text-muted-strong">Up to {plan.paymentLimit.toLocaleString()} payments per month</p><Link href={`/auth/sign-up?plan=${plan.key}`} className={cn(buttonVariants({ variant: plan.key === "free" ? "secondary" : "primary" }), "mt-5 w-full")}>{plan.key === "free" ? "Start free" : `Choose ${plan.name}`}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-surface py-18 sm:py-24">
        <div className="page-shell grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
          <div><p className="eyebrow">Questions</p><h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Before you upload a file.</h2></div>
          <div className="divide-y border-y">
            {[
              ["Does this replace QuickBooks or Xero?", "No. InvoiceReconcile is a reconciliation layer for incoming payments and open invoices. It prepares confirmed results and preserves the review history around them."],
              ["Will it post matches automatically?", "No. The first release is review and confirm. Uncertain cases never bulk approve by default, and accounting write-back is not implied."],
              ["Do I need to clean my spreadsheet first?", "No. The importer detects common header variations, currency formats, blank rows, dates, and duplicate rows. You confirm uncertain column mappings before processing."],
              ["How are combined payments found?", "The engine narrows candidate invoices by payer, date, account, currency, and references, then tests bounded combinations that can responsibly explain the payment."],
              ["Can a bookkeeping firm separate client data?", "Yes. Organization and workspace scopes separate memberships, imports, normalized records, matches, decisions, and audit history with row-level access policies."],
            ].map(([question, answer]) => <details key={question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold"><span>{question}</span><span className="text-xl font-light text-muted group-open:rotate-45">+</span></summary><p className="mt-3 max-w-2xl pr-10 text-sm leading-6 text-muted">{answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="bg-[#173d2e] py-16 text-white sm:py-20">
        <div className="page-shell grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9cdfbd]">Start with your files</p><h2 className="mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Bring the spreadsheet you reconcile every month.</h2><p className="mt-4 max-w-2xl text-base leading-7 text-[#c8dbd2]">Start with 50 payments per month free, including matching, review, and exports. Upgrade when you need more payments, client workspaces, or custom rules.</p></div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col"><Link href="/auth/sign-up" className="inline-flex min-h-12 items-center justify-center gap-2 border border-white bg-white px-5 font-semibold text-[#173d2e] hover:bg-[#eff7f3]">Start free <ArrowRight className="size-4" /></Link><Link href="/contact" className="inline-flex min-h-12 items-center justify-center border border-white/35 px-5 font-semibold hover:border-white">Ask about a file</Link></div>
        </div>
      </section>
    </MarketingFrame>
  );
}
