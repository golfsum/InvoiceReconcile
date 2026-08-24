import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Breadcrumbs } from "@/content/seo/seo-components";
import { buttonVariants } from "@/components/ui/button";

export function ToolShell({ title, description, children, note }: { title: string; description: string; children: ReactNode; note: string }) {
  return (
    <>
      <section className="border-b bg-surface">
        <div className="page-shell py-12 lg:py-16">
          <Breadcrumbs items={[{ label: "Tools", href: "/tools" }, { label: title }]} />
          <p className="eyebrow mt-9">Free reconciliation tool</p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-strong">{description}</p>
          <div className="mt-5 flex items-start gap-2 text-sm leading-6 text-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" /><p>{note}</p></div>
        </div>
      </section>
      <div className="page-shell py-12 lg:py-16">{children}</div>
      <section className="border-y bg-surface-muted">
        <div className="page-shell flex flex-col justify-between gap-6 py-10 md:flex-row md:items-center">
          <div><h2 className="text-2xl font-semibold">Have hundreds of these?</h2><p className="mt-2 text-sm leading-6 text-muted">Upload invoice and payment files to review exact, combined, partial, fee, duplicate, and unmatched cases together.</p></div>
          <div className="flex shrink-0 flex-wrap gap-3"><Link className={buttonVariants({ variant: "primary" })} href="/auth/sign-up">Start free <ArrowRight className="size-4" /></Link><Link className={buttonVariants({ variant: "secondary" })} href="/app/demo">Try sample data</Link></div>
        </div>
      </section>
    </>
  );
}

export const fieldClass = "mt-2 w-full border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-brand";
