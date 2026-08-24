import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingFrame } from "@/components/marketing/marketing-frame";
import { Breadcrumbs, canonicalMetadata } from "@/content/seo/seo-components";
import { solutionPages } from "@/content/seo/solutions";

export const metadata: Metadata = canonicalMetadata(
  "Payment reconciliation solutions",
  "Review InvoiceReconcile workflows for bookkeepers, accounting firms, and small businesses.",
  "/solutions",
);

export default function SolutionsPage() {
  return <MarketingFrame><header className="border-b bg-surface py-14 sm:py-18"><div className="page-shell"><Breadcrumbs items={[{ label: "Solutions" }]} /><p className="eyebrow mt-8">Solutions</p><h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Reconciliation workflows for the people doing the review.</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-muted-strong">See how the same import, evidence, review, and export workflow applies to different operating contexts.</p></div></header><section className="py-14 sm:py-18"><div className="page-shell grid gap-px border bg-border md:grid-cols-3">{Object.values(solutionPages).map((page) => <article className="bg-surface p-6" key={page.slug}><p className="eyebrow">{page.eyebrow}</p><h2 className="mt-4 text-xl font-semibold tracking-[-0.02em]">{page.title}</h2><p className="mt-3 text-sm leading-6 text-muted">{page.description}</p><Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline" href={`/solutions/${page.slug}`}>Review the workflow <ArrowRight className="size-4" /></Link></article>)}</div></section></MarketingFrame>;
}
