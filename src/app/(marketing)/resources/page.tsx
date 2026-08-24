import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs, canonicalMetadata } from "@/content/seo/seo-components";
import { resources } from "@/content/seo/resources";

export const metadata = canonicalMetadata(
  "Invoice Reconciliation Resources | InvoiceReconcile",
  "Practical guides for incoming payment matching, accounts receivable reconciliation, partials, grouped payments, fees, and Excel workflows.",
  "/resources",
);

export default function ResourcesPage() {
  return (
    <>
      <section className="border-b bg-surface">
        <div className="page-shell py-14 lg:py-20">
          <Breadcrumbs items={[{ label: "Resources" }]} />
          <p className="eyebrow mt-10">Resource library</p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Practical incoming-payment reconciliation guides</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-strong">Procedures, examples, and controls for people who need to explain how customer cash connects to open invoices. No arbitrary word count and no invented benchmark claims.</p>
        </div>
      </section>
      <div className="page-shell py-14 lg:py-20">
        <div className="border-y divide-y">
          {resources.map((article, index) => (
            <article className="grid gap-4 py-7 md:grid-cols-[70px_1fr_auto] md:items-start" key={article.slug}>
              <span className="font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted"><span className="text-brand">{article.category}</span><span aria-hidden="true">/</span><span>{article.readingMinutes} min</span></div>
                <h2 className="mt-2 text-xl font-semibold tracking-[-0.015em]"><Link className="hover:text-brand" href={`/resources/${article.slug}`}>{article.title}</Link></h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{article.description}</p>
              </div>
              <Link href={`/resources/${article.slug}`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline" aria-label={`Read ${article.title}`}>Read guide <ArrowRight className="size-4" /></Link>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
