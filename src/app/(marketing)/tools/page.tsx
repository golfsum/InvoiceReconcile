import Link from "next/link";
import { ArrowRight, Calculator, Combine, ListChecks, ReceiptText, TextCursorInput } from "lucide-react";
import { Breadcrumbs, canonicalMetadata } from "@/content/seo/seo-components";

export const metadata = canonicalMetadata(
  "Free Invoice Reconciliation Tools | InvoiceReconcile",
  "Use free browser-based tools for lump-sum invoice matching, obvious payment matching, partial allocations, time estimates, and reference cleanup.",
  "/tools",
);

const tools = [
  { href: "/tools/lump-sum-invoice-matcher", title: "Lump-sum invoice matcher", description: "Find invoice combinations that equal one customer payment.", icon: Combine },
  { href: "/tools/invoice-payment-matcher", title: "Invoice payment matcher", description: "Compare short invoice and payment lists for unique exact amounts.", icon: ListChecks },
  { href: "/tools/reconciliation-time-calculator", title: "Reconciliation time calculator", description: "Estimate current manual hours and labor cost using your own inputs.", icon: Calculator },
  { href: "/tools/partial-payment-allocation", title: "Partial payment allocation", description: "Apply a payment across invoice balances in a chosen order.", icon: ReceiptText },
  { href: "/tools/invoice-reference-cleaner", title: "Invoice reference cleaner", description: "Normalize messy invoice references without uploading a file.", icon: TextCursorInput },
] as const;

export default function ToolsPage() {
  return (
    <>
      <section className="border-b bg-surface"><div className="page-shell py-14 lg:py-20"><Breadcrumbs items={[{ label: "Tools" }]} /><p className="eyebrow mt-10">Free tools</p><h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Solve a specific reconciliation question</h1><p className="mt-6 max-w-3xl text-lg leading-8 text-muted-strong">These tools run in your browser and produce concrete calculations. They do not post transactions, change books, or turn an amount coincidence into a confirmed accounting decision.</p></div></section>
      <div className="page-shell py-14 lg:py-20"><div className="grid gap-px border bg-border md:grid-cols-2">{tools.map((tool) => { const Icon = tool.icon; return <Link className="group bg-surface p-7 hover:bg-brand-soft" href={tool.href} key={tool.href}><Icon className="size-5 text-brand" /><h2 className="mt-5 text-xl font-semibold">{tool.title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted">{tool.description}</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand">Open tool <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span></Link>; })}</div></div>
    </>
  );
}
