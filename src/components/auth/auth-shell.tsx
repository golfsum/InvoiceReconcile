import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";

export function AuthShell({ children, title, description }: { children: ReactNode; title: string; description: string }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex min-h-screen flex-col bg-surface px-5 py-6 sm:px-10 lg:px-14">
        <BrandLogo />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{title}</h1>
          <p className="mt-3 text-base leading-7 text-muted">{description}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-7 text-xs leading-5 text-muted">By continuing, you agree to the <Link className="font-semibold text-foreground hover:underline" href="/terms">Terms</Link> and acknowledge the <Link className="font-semibold text-foreground hover:underline" href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </div>
      <aside className="hidden bg-[#173d2e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="max-w-md">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9cdfbd]">First result in minutes</p>
          <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.045em]">Bring invoices. Bring payments. Review what does not line up.</h2>
          <ul className="mt-10 space-y-5 text-sm text-[#d3e3dc]">
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#8ed8b5]" /> Map messy CSV and XLSX columns without cleaning the source file first.</li>
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#8ed8b5]" /> See the amount, payer, reference, date, and currency evidence behind every suggestion.</li>
            <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#8ed8b5]" /> Keep uncertain matches in a human review queue.</li>
          </ul>
        </div>
        <div className="flex items-center gap-3 border-t border-white/15 pt-6 text-xs text-[#b9cec4]"><ShieldCheck className="size-4" /> Financial changes are never posted automatically.</div>
      </aside>
    </main>
  );
}
