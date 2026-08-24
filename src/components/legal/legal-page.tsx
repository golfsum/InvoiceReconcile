import Link from "next/link";
import { LEGAL_OWNER_REVIEW_REQUIRED, type LegalDocument } from "@/content/legal";
import { MarketingFrame } from "@/components/marketing/marketing-frame";
import { ContactForm } from "@/components/legal/contact-form";

export function LegalPage({ document }: { document: LegalDocument }) {
  const sections = document.sections.filter(
    (section) => section.id !== "owner-review" || LEGAL_OWNER_REVIEW_REQUIRED,
  );

  return (
    <MarketingFrame>
      <header className="border-b bg-surface">
        <div className="page-shell py-16 sm:py-20">
          <p className="eyebrow">{document.eyebrow}</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {document.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-strong">{document.description}</p>
          {document.slug !== "contact" ? (
            <p className="mt-5 text-sm font-medium text-muted">Effective {document.effectiveDate}</p>
          ) : null}
        </div>
      </header>

      <div className="page-shell grid gap-10 py-12 lg:grid-cols-[15rem_minmax(0,48rem)] lg:items-start lg:justify-center">
        <aside className="border bg-surface p-4 lg:sticky lg:top-24" aria-label={`${document.title} contents`}>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">On this page</p>
          <nav className="mt-3">
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a className="block border-l-2 border-transparent px-3 py-2 text-sm text-muted-strong hover:border-brand hover:text-foreground" href={`#${section.id}`}>
                    {section.title.replace(/^\d+\.\s*/, "")}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-5 border-t pt-4 text-sm text-muted">
            Need help? <Link className="font-semibold text-brand hover:underline" href="mailto:support@invoicereconcile.com">Email support</Link>.
          </div>
        </aside>

        <article className="min-w-0">
          <div className="space-y-4 border-b pb-9 text-base leading-8 text-muted-strong">
            {document.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <div className="divide-y">
            {sections.map((section) => (
              <section id={section.id} key={section.id} className="scroll-mt-24 py-9 first:pt-9">
                <h2 className="text-xl font-semibold tracking-[-0.025em]">{section.title}</h2>
                {section.paragraphs?.length ? (
                  <div className="mt-4 space-y-4 text-[0.96rem] leading-7 text-muted-strong">
                    {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                ) : null}
                {section.items?.length ? (
                  <ul className="mt-5 space-y-3 text-[0.96rem] leading-7 text-muted-strong">
                    {section.items.map((item) => (
                      <li className="grid grid-cols-[0.45rem_1fr] gap-3" key={item}>
                        <span className="mt-[0.68rem] size-1.5 bg-brand" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.table ? (
                  <div className="mt-5 overflow-x-auto border" tabIndex={0} aria-label={`Scrollable ${section.title} table`}>
                    <table className="w-full min-w-[38rem] text-left text-sm">
                      <thead className="border-b bg-surface-muted">
                        <tr>{section.table.headers.map((header) => <th className="px-4 py-3 font-semibold" key={header}>{header}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {section.table.rows.map((row, rowIndex) => (
                          <tr key={`${section.id}-${rowIndex}`}>{row.map((cell, cellIndex) => <td className="px-4 py-3 align-top leading-6 text-muted-strong" key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {section.afterParagraphs?.length ? (
                  <div className="mt-4 space-y-4 text-[0.96rem] leading-7 text-muted-strong">
                    {section.afterParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                ) : null}
                {section.callout ? (
                  <div className={`mt-5 border-l-4 p-4 ${section.callout.tone === "warning" ? "border-warning bg-warning-soft text-warning" : "border-brand bg-brand-soft text-foreground"}`}>
                    <p className="font-semibold">{section.callout.title}</p>
                    <p className="mt-1 text-sm leading-6">{section.callout.text}</p>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
          {document.slug === "contact" ? <ContactForm /> : null}
        </article>
      </div>
    </MarketingFrame>
  );
}
