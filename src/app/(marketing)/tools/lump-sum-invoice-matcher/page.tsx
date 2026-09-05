import Link from "next/link";
import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { LumpSumMatcher } from "./lump-sum-matcher";

export const metadata = canonicalMetadata("Free Invoice Sum Matcher: Match One Payment to Invoices | InvoiceReconcile", "Find which invoices add up to a payment. Try the $4,725 example or enter up to 20 balances. Free, no signup, calculations stay in your browser.", "/tools/lump-sum-invoice-matcher");

export default function LumpSumMatcherPage() {
  return <ToolShell title="Lump-sum invoice matcher" description="Find which invoices add up to one payment. Enter a payment amount and up to 20 open invoice balances, then review the exact combinations. No signup required." note="The calculation runs locally in your browser. Do not treat an amount-only result as a confirmed accounting match.">
    <LumpSumMatcher />
    <div className="mt-16 max-w-3xl space-y-10">
      <section aria-labelledby="sum-example">
        <h2 id="sum-example" className="text-2xl font-semibold">Example: which invoices add up to $4,725?</h2>
        <p className="mt-4 text-base leading-7 text-muted-strong">The prefilled fictional example contains five invoices. Click Find combinations to identify INV-2108 ($1,500), INV-2141 ($1,225), and INV-2190 ($2,000). Together they total $4,725. The $750 and $6,200 invoices are not part of that combination.</p>
        <p className="mt-3 text-base leading-7 text-muted-strong">That arithmetic proposes an allocation; it does not confirm the customer intended it. Check the payer, currency, remittance and current balances before recording a payment.</p>
      </section>
      <section aria-labelledby="sum-method">
        <h2 id="sum-method" className="text-2xl font-semibold">How to match one payment to multiple invoices</h2>
        <ol className="mt-4 list-decimal space-y-3 pl-6 text-base leading-7 text-muted-strong">
          <li>Start with open invoices for one customer and one currency. Use the remaining balance, not an already-paid invoice total.</li>
          <li>Enter the payment amount and each invoice on a separate line, using the format shown in the form.</li>
          <li>Run the calculation and compare the proposed combinations with the customer&apos;s remittance.</li>
          <li>Keep the chosen allocation and its supporting payment reference in your reconciliation record.</li>
        </ol>
      </section>
      <section aria-labelledby="sum-questions">
        <h2 id="sum-questions" className="text-2xl font-semibold">When the amounts do not settle the question</h2>
        <h3 className="mt-5 text-lg font-semibold">What if several combinations match?</h3>
        <p className="mt-2 leading-7 text-muted-strong">Do not select the first result automatically. Different invoice sets can share the same total. Ask for invoice references or remittance advice. The search considers up to 8 invoices per combination and returns at most 12 results, so it is not an exhaustive accounting conclusion.</p>
        <h3 className="mt-5 text-lg font-semibold">What if no exact combination matches?</h3>
        <p className="mt-2 leading-7 text-muted-strong">Check for partial payments, fees, credits, missing invoices and stale balances. This tool searches positive invoice amounts for exact totals; it does not infer fees or assign partial amounts. Try the <Link className="text-brand underline" href="/tools/partial-payment-allocation">partial-payment allocation calculator</Link> when you already know the intended order of allocation.</p>
        <h3 className="mt-5 text-lg font-semibold">Is this a bank reconciliation calculator?</h3>
        <p className="mt-2 leading-7 text-muted-strong">No. It finds invoice combinations for a receipt. It does not compare your cash ledger with a bank statement, reconcile an AR control account, or post entries.</p>
      </section>
      <section className="border-t pt-6"><h2 className="text-xl font-semibold">Continue with a worked guide</h2><div className="mt-4 flex flex-col gap-3 text-sm font-semibold text-brand">
        <Link className="underline underline-offset-4" href="/resources/how-to-reconcile-bank-deposits-with-invoices">Reconcile direct deposits, combined payments and processor payouts</Link>
        <Link className="underline underline-offset-4" href="/resources/accounts-receivable-reconciliation-example">Follow a complete AR reconciliation example</Link>
        <Link className="underline underline-offset-4" href="/excel-invoice-reconciliation">Download fictional invoice and payment CSV files</Link>
      </div></section>
    </div>
  </ToolShell>;
}
