import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { ReferenceCleaner } from "./reference-cleaner";

export const metadata = canonicalMetadata("Invoice Reference Cleaner | InvoiceReconcile", "Normalize invoice references for comparison by standardizing labels, punctuation, spacing, and case in your browser.", "/tools/invoice-reference-cleaner");

export default function InvoiceReferenceCleanerPage() {
  return <ToolShell title="Invoice reference cleaner" description="Turn inconsistent invoice reference formatting into repeatable comparison keys while keeping the original text visible." note="The references stay in your browser. Use the output for comparison only and preserve the original value in every source record."><ReferenceCleaner /></ToolShell>;
}
