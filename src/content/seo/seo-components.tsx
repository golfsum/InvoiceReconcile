import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FREE_MONTHLY_PAYMENT_LIMIT, siteConfig } from "@/lib/config";
import type { AudiencePage, ReconciliationExample, SeoPage } from "./types";

export function canonicalMetadata(title: string, description: string, path: string): Metadata {
  const canonical = new URL(path, siteConfig.url).toString();
  const absoluteTitle = /\|\s*InvoiceReconcile$/i.test(title) ? title : `${title} | InvoiceReconcile`;
  return {
    title: { absolute: absoluteTitle },
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title: absoluteTitle,
      description,
      url: canonical,
      siteName: siteConfig.name,
    },
    twitter: {
      card: "summary_large_image",
      title: absoluteTitle,
      description,
    },
  };
}

export function JsonLd({ value }: { value: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(value).replace(/</g, "\\u003c") }}
    />
  );
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li><Link className="hover:text-foreground" href="/">Home</Link></li>
        {items.map((item) => (
          <li key={`${item.href}-${item.label}`} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5" aria-hidden="true" />
            {item.href ? <Link className="hover:text-foreground" href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ExampleLedger({ example }: { example: ReconciliationExample }) {
  return (
    <aside className="border bg-surface shadow-panel" aria-label={`${example.label} example`}>
      <div className="border-b px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Worked example</p>
        <h2 className="mt-1 text-base font-semibold">{example.label}</h2>
      </div>
      <dl className="divide-y">
        <div className="grid grid-cols-[110px_1fr] px-5 py-3 text-sm">
          <dt className="text-muted">Payment</dt>
          <dd className="text-right font-mono font-semibold">{example.payment}</dd>
        </div>
        <div className="grid grid-cols-[110px_1fr] px-5 py-3 text-sm">
          <dt className="text-muted">Invoices</dt>
          <dd className="space-y-1 text-right font-mono">
            {example.invoices.map((invoice) => <div key={invoice}>{invoice}</div>)}
          </dd>
        </div>
        <div className="grid grid-cols-[110px_1fr] bg-brand-soft px-5 py-3 text-sm">
          <dt className="text-brand">Result</dt>
          <dd className="text-right font-semibold text-brand">{example.outcome}</dd>
        </div>
      </dl>
      <p className="border-t px-5 py-4 text-sm leading-6 text-muted">{example.note}</p>
    </aside>
  );
}

export function SeoLandingPage({ page }: { page: SeoPage }) {
  const canonical = new URL(`/${page.slug}`, siteConfig.url).toString();
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
      { "@type": "ListItem", position: 2, name: page.title, item: canonical },
    ],
  };
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    url: siteConfig.url,
    description: siteConfig.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free plan available" },
  };

  return (
    <>
      <JsonLd value={breadcrumb} />
      <JsonLd value={software} />
      <section className="border-b bg-surface">
        <div className="page-shell py-14 lg:py-20">
          <Breadcrumbs items={[{ label: page.title }]} />
          <div className="mt-10 grid items-start gap-12 lg:grid-cols-[minmax(0,1.2fr)_420px]">
            <div>
              <p className="eyebrow">{page.eyebrow}</p>
              <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{page.title}</h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-strong">{page.intro}</p>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-muted"><span className="font-semibold text-foreground">Best fit:</span> {page.audience}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/auth/sign-up" className={buttonVariants({ variant: "primary", size: "lg" })}>{page.cta}</Link>
                <Link href="/app/demo" className={buttonVariants({ variant: "secondary", size: "lg" })}>Try sample data</Link>
              </div>
              <p className="mt-3 text-xs text-muted">{FREE_MONTHLY_PAYMENT_LIMIT} payments per month free. No credit card or accounting connection required.</p>
            </div>
            <ExampleLedger example={page.example} />
          </div>
        </div>
      </section>

      <article className="page-shell grid gap-14 py-16 lg:grid-cols-[minmax(0,1fr)_280px] lg:py-20">
        <div className="space-y-14">
          {page.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">{section.heading}</h2>
              <div className="mt-5 space-y-4 text-base leading-7 text-muted-strong">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {section.bullets ? (
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3 border-t pt-3 text-sm leading-6 text-muted-strong">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          {page.downloads ? (
            <section>
              <h2 className="text-2xl font-semibold tracking-[-0.02em]">Download a reconciliation-ready CSV pair</h2>
              <p className="mt-4 text-base leading-7 text-muted-strong">Use these fictional files to inspect a practical column layout or test the sample workflow. No customer data is included.</p>
              <div className="mt-6 grid gap-px border bg-border sm:grid-cols-2">
                {page.downloads.map((download) => (
                  <a className="group bg-surface p-5 hover:bg-brand-soft" download href={download.href} key={download.href}>
                    <span className="flex items-center justify-between gap-3 font-semibold text-brand">{download.label}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
                    <span className="mt-2 block text-sm leading-6 text-muted">{download.description}</span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border-l-2 border-brand pl-5">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em]">A responsible workflow</h2>
            <ul className="mt-4 space-y-4">
              {page.checklist.map((item) => <li key={item} className="text-sm leading-6 text-muted-strong">{item}</li>)}
            </ul>
          </div>
        </aside>
      </article>

      <section className="border-t bg-brand-soft">
        <div className="page-shell grid gap-6 py-12 sm:grid-cols-[1fr_auto] sm:items-center">
          <div><h2 className="text-2xl font-semibold tracking-tight">Try this workflow on your next reconciliation.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-strong">Start with {FREE_MONTHLY_PAYMENT_LIMIT} payments per month, including CSV/XLSX imports, exception review, and exports. Upgrade when you need more volume, client workspaces, or custom rules.</p><Link href="/pricing" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">Compare plans from $19/month</Link></div>
          <Link href="/auth/sign-up" className={buttonVariants({ variant: "primary", size: "lg" })}>Start my free workspace <ArrowRight className="size-4" /></Link>
        </div>
      </section>

      <section className="border-y bg-surface-muted">
        <div className="page-shell py-14">
          <h2 className="text-2xl font-semibold">Continue researching</h2>
          <div className="mt-7 grid divide-y border-y md:grid-cols-3 md:divide-x md:divide-y-0">
            {page.related.map((item) => (
              <Link key={item.href} href={item.href} className="group bg-surface p-6 hover:bg-brand-soft">
                <span className="flex items-center justify-between gap-3 font-semibold">{item.label}<ArrowRight className="size-4 text-brand transition-transform group-hover:translate-x-1" /></span>
                <span className="mt-2 block text-sm leading-6 text-muted">{item.description}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export function AudienceLandingPage({ page, section }: { page: AudiencePage; section: "Solutions" | "Industries" }) {
  const path = `/${section.toLowerCase()}/${page.slug}`;
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
      { "@type": "ListItem", position: 2, name: section, item: new URL(`/${section.toLowerCase()}`, siteConfig.url).toString() },
      { "@type": "ListItem", position: 3, name: page.title, item: new URL(path, siteConfig.url).toString() },
    ],
  };
  return (
    <>
      <JsonLd value={breadcrumb} />
      <section className="border-b bg-surface">
        <div className="page-shell py-14 lg:py-20">
          <Breadcrumbs items={[{ label: section, href: `/${section.toLowerCase()}` }, { label: page.title }]} />
          <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <p className="eyebrow">{page.eyebrow}</p>
              <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{page.title}</h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-strong">{page.intro}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link className={buttonVariants({ variant: "primary", size: "lg" })} href="/auth/sign-up">Start free</Link>
                <Link className={buttonVariants({ variant: "secondary", size: "lg" })} href="/app/demo">Open the demo workspace</Link>
              </div>
            </div>
            <ExampleLedger example={page.example} />
          </div>
        </div>
      </section>
      <div className="page-shell py-16 lg:py-20">
        <section>
          <p className="eyebrow">Where time gets lost</p>
          <div className="mt-6 grid gap-px border bg-border md:grid-cols-3">
            {page.painPoints.map((item) => (
              <div className="bg-surface p-6" key={item.title}>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-3 text-sm leading-6 text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-16 grid gap-10 lg:grid-cols-[260px_1fr]">
          <div>
            <p className="eyebrow">Working method</p>
            <h2 className="mt-3 text-2xl font-semibold">A short path from files to evidence</h2>
          </div>
          <ol className="divide-y border-y">
            {page.workflow.map((item, index) => (
              <li className="grid gap-3 py-6 sm:grid-cols-[48px_180px_1fr]" key={item.title}>
                <span className="font-mono text-sm text-brand">0{index + 1}</span>
                <span className="font-semibold">{item.title}</span>
                <span className="text-sm leading-6 text-muted">{item.detail}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="mt-16 border-y py-10">
          <h2 className="text-2xl font-semibold">Controls that matter</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {page.controls.map((control) => <li key={control} className="flex gap-3 text-sm leading-6 text-muted-strong"><Check className="mt-0.5 size-4 shrink-0 text-success" />{control}</li>)}
          </ul>
        </section>
        <section className="mt-16">
          <h2 className="text-2xl font-semibold">Related workflows</h2>
          <div className="mt-6 flex flex-wrap gap-3">
            {page.related.map((item) => <Link key={item.href} className={buttonVariants({ variant: "secondary" })} href={item.href}>{item.label}</Link>)}
          </div>
        </section>
      </div>
    </>
  );
}
