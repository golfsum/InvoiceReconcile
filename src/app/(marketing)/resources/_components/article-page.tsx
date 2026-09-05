import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Breadcrumbs, JsonLd } from "@/content/seo/seo-components";
import { resourceBySlug } from "@/content/seo/resources";
import type { ResourceArticle } from "@/content/seo/types";
import { siteConfig } from "@/lib/config";

export function ResourceArticlePage({ article }: { article: ResourceArticle }) {
  const url = new URL(`/resources/${article.slug}`, siteConfig.url).toString();
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.published || article.updated,
    dateModified: article.updated,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: siteConfig.name, url: siteConfig.url },
    publisher: { "@type": "Organization", name: siteConfig.name, url: siteConfig.url },
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
      { "@type": "ListItem", position: 2, name: "Resources", item: new URL("/resources", siteConfig.url).toString() },
      { "@type": "ListItem", position: 3, name: article.title, item: url },
    ],
  };
  return (
    <>
      <JsonLd value={articleSchema} />
      <JsonLd value={breadcrumbSchema} />
      <header className="border-b bg-surface">
        <div className="page-shell max-w-[1040px] py-12 lg:py-16">
          <Breadcrumbs items={[{ label: "Resources", href: "/resources" }, { label: article.title }]} />
          <div className="mt-10 max-w-3xl">
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted"><span className="text-brand">{article.category}</span><span aria-hidden="true">/</span><span>{article.readingMinutes} minute read</span><span aria-hidden="true">/</span><time dateTime={article.updated}>Updated {new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${article.updated}T00:00:00Z`))}</time></div>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{article.title}</h1>
            <p className="mt-6 text-lg leading-8 text-muted-strong">{article.intro}</p>
          </div>
        </div>
      </header>
      <article className="page-shell grid max-w-[1040px] gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_240px] lg:py-20">
        <div className="min-w-0 space-y-14">
          {article.example ? (
            <section className="border bg-surface" aria-labelledby="worked-example">
              <div className="border-b px-5 py-4"><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Worked example</p><h2 id="worked-example" className="mt-1 text-lg font-semibold">{article.example.label}</h2></div>
              <div className="grid divide-y sm:grid-cols-[1fr_1.25fr_1.25fr] sm:divide-x sm:divide-y-0">
                <div className="p-5"><p className="text-xs uppercase tracking-[0.08em] text-muted">Payment</p><p className="mt-2 font-mono font-semibold">{article.example.payment}</p></div>
                <div className="p-5"><p className="text-xs uppercase tracking-[0.08em] text-muted">Invoice records</p><div className="mt-2 space-y-1 font-mono text-sm">{article.example.invoices.map((item) => <p key={item}>{item}</p>)}</div></div>
                <div className="bg-brand-soft p-5"><p className="text-xs uppercase tracking-[0.08em] text-brand">Review result</p><p className="mt-2 font-semibold text-brand">{article.example.outcome}</p></div>
              </div>
              <p className="border-t px-5 py-4 text-sm leading-6 text-muted">{article.example.note}</p>
            </section>
          ) : null}
          {article.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">{section.heading}</h2>
              <div className="mt-5 space-y-4 text-base leading-7 text-muted-strong">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              {section.bullets ? <ul className="mt-6 border-y divide-y">{section.bullets.map((bullet) => <li className="flex gap-3 py-3 text-sm leading-6 text-muted-strong" key={bullet}><Check className="mt-0.5 size-4 shrink-0 text-success" />{bullet}</li>)}</ul> : null}
              {section.table ? <div className="mt-6 overflow-x-auto rounded-sm border" tabIndex={0} role="region" aria-label={section.table.caption}>
                <table className="w-full text-left text-sm">
                  <caption className="p-4 text-left font-semibold">{section.table.caption}</caption>
                  <thead className="border-y bg-surface-muted"><tr>{section.table.headers.map((header) => <th className="p-3 font-semibold" scope="col" key={header}>{header}</th>)}</tr></thead>
                  <tbody className="divide-y">{section.table.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th className="p-3 font-medium" scope="row" key={index}>{cell}</th> : <td className="p-3" key={index}>{cell}</td>)}</tr>)}</tbody>
                </table>
              </div> : null}
            </section>
          ))}
          <section className="border-l-2 border-brand bg-surface px-6 py-5">
            <h2 className="text-lg font-semibold">Key takeaways</h2>
            <ul className="mt-4 space-y-3">{article.takeaways.map((item) => <li className="flex gap-3 text-sm leading-6 text-muted-strong" key={item}><Check className="mt-0.5 size-4 shrink-0 text-success" />{item}</li>)}</ul>
          </section>
          {article.sources?.length ? <section className="border-t pt-6"><h2 className="text-lg font-semibold">Sources and further reading</h2><ul className="mt-4 space-y-3">{article.sources.map((source) => <li key={source.href}><a className="text-sm text-brand underline underline-offset-4" href={source.href}>{source.label}</a></li>)}</ul></section> : null}
          {article.nextSteps?.length ? <section className="border bg-brand-soft p-6"><h2 className="text-xl font-semibold">Try the payment-matching step</h2><p className="mt-3 text-sm leading-6 text-muted-strong">InvoiceReconcile helps compare invoice and payment files. It does not reconcile your general ledger or automatically post to your books.</p><div className="mt-4 flex flex-wrap gap-4">{article.nextSteps.map((step) => <Link className="text-sm font-semibold text-brand underline underline-offset-4" href={step.href} key={step.href}>{step.label}</Link>)}</div></section> : null}
          <p className="border-t pt-5 text-xs leading-5 text-muted">This material is general educational information, not accounting, tax, legal, or investment advice. Verify financial records and consult the appropriate professional for decisions that require judgment.</p>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Related reading</p>
          <div className="mt-4 divide-y border-y">
            {article.related.map((slug) => {
              const related = resourceBySlug[slug];
              return <Link className="group block py-4 text-sm font-semibold leading-5 hover:text-brand" href={`/resources/${slug}`} key={slug}>{related.title}<ArrowRight className="ml-1 inline size-3.5 transition-transform group-hover:translate-x-1" /></Link>;
            })}
          </div>
          <div className="mt-8 border-l-2 border-brand pl-4">
            <p className="text-sm font-semibold">Ready to test the workflow?</p>
            <p className="mt-2 text-sm leading-6 text-muted">Use fictional invoice and payment files in the Northstar demo workspace.</p>
            <Link href="/app/demo" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">Open sample data <ArrowRight className="size-3.5" /></Link>
          </div>
        </aside>
      </article>
    </>
  );
}
