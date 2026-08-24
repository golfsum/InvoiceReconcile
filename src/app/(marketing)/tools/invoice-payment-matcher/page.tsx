import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { InvoicePaymentMatcher } from "./invoice-payment-matcher";

export const metadata = canonicalMetadata("Free Invoice Payment Matcher | InvoiceReconcile", "Paste short invoice and payment lists to identify unique exact amounts and surface ambiguous repeated values.", "/tools/invoice-payment-matcher");

export default function InvoicePaymentMatcherPage() {
  return <ToolShell title="Invoice payment matcher" description="Compare a short open-invoice list with incoming payments. Unique exact amounts are separated from repeated and unmatched values." note="The lists stay in your browser. Amount equality alone does not confirm payer identity, currency, references, dates, or duplicate status."><InvoicePaymentMatcher /></ToolShell>;
}
