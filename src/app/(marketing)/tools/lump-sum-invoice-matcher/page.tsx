import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { LumpSumMatcher } from "./lump-sum-matcher";

export const metadata = canonicalMetadata("Free Lump-Sum Invoice Matcher | InvoiceReconcile", "Enter one payment and up to 20 invoice balances to find exact invoice combinations in your browser.", "/tools/lump-sum-invoice-matcher");

export default function LumpSumMatcherPage() {
  return <ToolShell title="Lump-sum invoice matcher" description="Enter one payment and a short list of open invoice balances. The tool finds exact combinations using integer cents and bounded search limits." note="The calculation runs locally in your browser. Do not treat an amount-only result as a confirmed accounting match."><LumpSumMatcher /></ToolShell>;
}
