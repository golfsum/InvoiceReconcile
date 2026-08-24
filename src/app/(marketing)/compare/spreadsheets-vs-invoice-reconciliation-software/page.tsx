import Link from "next/link";
import { Check } from "lucide-react";
import { Breadcrumbs, canonicalMetadata } from "@/content/seo/seo-components";
import { buttonVariants } from "@/components/ui/button";

export const metadata = canonicalMetadata(
  "Spreadsheets vs Invoice Reconciliation Software | InvoiceReconcile",
  "Compare spreadsheet and specialized invoice reconciliation workflows fairly across cost, flexibility, controls, volume, and audit history.",
  "/compare/spreadsheets-vs-invoice-reconciliation-software",
);

const rows = [
  ["Initial cost", "Usually low when the team already has Excel or Sheets", "Subscription and implementation time"],
  ["Format flexibility", "Excellent for one-off edits and unusual source data", "Strong when an importer previews and saves mappings"],
  ["Combined payments", "Possible with formulas, Solver, or manual combination search", "Purpose-built candidate narrowing and bounded subset search"],
  ["Partial payments", "Requires a separate applications table and careful formulas", "Applied, remaining, and unapplied values can be modeled directly"],
  ["Duplicate controls", "Must be designed, maintained, and checked by the workbook owner", "File hashes and transaction identifiers can be checked consistently"],
  ["Collaboration", "Easy to share, but concurrent edits and versions need governance", "Roles, workspaces, and recorded decisions support a controlled queue"],
  ["Audit history", "Possible with protected archives, version history, and review columns", "Actions can record user, time, source, prior state, and decision"],
  ["Best fit", "Low volume, stable formats, one capable owner, limited exceptions", "Recurring volume, several reviewers or clients, difficult exceptions"],
] as const;

export default function SpreadsheetComparisonPage() {
  return (
    <>
      <section className="border-b bg-surface">
        <div className="page-shell py-14 lg:py-20">
          <Breadcrumbs items={[{ label: "Compare" }, { label: "Spreadsheets vs reconciliation software" }]} />
          <p className="eyebrow mt-10">Fair workflow comparison</p>
          <h1 className="mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Spreadsheets vs invoice reconciliation software</h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-strong">Spreadsheets are a sensible tool for low-volume, stable work. Specialized software begins to earn its place when import variation, grouped payments, multiple reviewers, or audit requirements turn workbook maintenance into the main job.</p>
        </div>
      </section>

      <div className="page-shell py-16 lg:py-20">
        <section aria-labelledby="comparison-heading">
          <h2 id="comparison-heading" className="text-2xl font-semibold">Side-by-side operating tradeoffs</h2>
          <div className="mt-6 overflow-x-auto border">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted">
                <tr><th className="w-1/5 border-b px-5 py-4 font-semibold">Area</th><th className="w-2/5 border-b px-5 py-4 font-semibold">Spreadsheet</th><th className="w-2/5 border-b px-5 py-4 font-semibold">Reconciliation software</th></tr>
              </thead>
              <tbody className="divide-y bg-surface">
                {rows.map(([area, spreadsheet, software]) => <tr key={area}><th scope="row" className="px-5 py-4 align-top font-semibold">{area}</th><td className="px-5 py-4 align-top leading-6 text-muted-strong">{spreadsheet}</td><td className="px-5 py-4 align-top leading-6 text-muted-strong">{software}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-16 grid gap-12 lg:grid-cols-2">
          <section>
            <p className="eyebrow">Stay with a spreadsheet when</p>
            <h2 className="mt-3 text-2xl font-semibold">The process is still small and inspectable</h2>
            <ul className="mt-6 space-y-4">
              {["One trained person owns the workbook and review.", "Source columns remain stable from period to period.", "Most receipts are exact one-to-one matches.", "The team can archive protected, reviewed versions.", "The exception list is short enough to investigate manually."].map((item) => <li className="flex gap-3 text-sm leading-6 text-muted-strong" key={item}><Check className="mt-0.5 size-4 shrink-0 text-success" />{item}</li>)}
            </ul>
          </section>
          <section>
            <p className="eyebrow">Consider software when</p>
            <h2 className="mt-3 text-2xl font-semibold">The workbook is becoming the control system</h2>
            <ul className="mt-6 space-y-4">
              {["Several people prepare or approve applications.", "One payment often covers several invoices.", "Duplicate imports or copied formulas create recurring risk.", "Client-specific formats and aliases need to be remembered.", "Reviewers cannot reconstruct decisions from the final file."].map((item) => <li className="flex gap-3 text-sm leading-6 text-muted-strong" key={item}><Check className="mt-0.5 size-4 shrink-0 text-success" />{item}</li>)}
            </ul>
          </section>
        </div>

        <section className="mt-16 border-y py-10">
          <h2 className="text-2xl font-semibold">A low-risk transition</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-strong">Do not replace a working process overnight. Export the same open invoices and payments used by the current workbook, run a parallel reconciliation, and compare exact matches, exceptions, totals, and reviewer time. Keep the accounting system as the final ledger. Adopt the new workflow only after the team understands how errors and unresolved items are handled.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link className={buttonVariants({ variant: "primary" })} href="/app/demo">Test sample data</Link><Link className={buttonVariants({ variant: "secondary" })} href="/resources/how-to-reconcile-invoices-in-excel">Build a safer Excel process</Link></div>
        </section>
      </div>
    </>
  );
}
