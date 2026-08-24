import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { PartialAllocationCalculator } from "./partial-allocation";

export const metadata = canonicalMetadata("Partial Payment Allocation Calculator | InvoiceReconcile", "Apply one payment across ordered invoice balances and calculate applied, remaining, and unapplied amounts.", "/tools/partial-payment-allocation");

export default function PartialPaymentAllocationPage() {
  return <ToolShell title="Partial payment allocation calculator" description="Apply one payment across a short ordered list of invoice balances. See the amount applied, balance remaining, and any unapplied cash." note="The calculation stays in your browser. Allocation order is not proof of customer intent and should be checked against remittance evidence."><PartialAllocationCalculator /></ToolShell>;
}
