import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingFrame } from "@/components/marketing/marketing-frame";
import { Breadcrumbs, canonicalMetadata } from "@/content/seo/seo-components";
import { industryPages } from "@/content/seo/industries";

export const metadata: Metadata = canonicalMetadata(
  "Payment reconciliation by industry",
  "Review incoming-payment reconciliation examples for accounting firms, bookkeepers, consulting, agencies, and B2B services.",
  "/industries",
);

export default function IndustriesPage() {
  return <MarketingFrame><header className="border-b bg-surface py-14 sm:py-18"><div className="page-shell"><Breadcrumbs items={[{ label: "Industries" }]} /><p className="eyebrow mt-8">Industries</p><h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Follow the payment evidence that matters in your industry.</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-muted-strong">Explore representative payment, invoice, and exception patterns without assuming an accounting treatment or automatic write-back.</p></div></header><section className="py-14 sm:py-18"><div className="page-shell grid gap-px border bg-border md:grid-cols-2 lg:grid-cols-3">{Object.values(industryPages).map((page) => <article className="bg-surface p-6" key={page.slug}><p className="eyebrow">{page.eyebrow}</p><h2 className="mt-4 text-xl font-semibold tracking-[-0.02em]">{page.title}</h2><p className="mt-3 text-sm leading-6 text-muted">{page.description}</p><Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline" href={`/industries/${page.slug}`}>See industry examples <ArrowRight className="size-4" /></Link></article>)}</div></section></MarketingFrame>;
}
