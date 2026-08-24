import { canonicalMetadata } from "@/content/seo/seo-components";
import { ToolShell } from "../_components/tool-shell";
import { TimeCalculator } from "./time-calculator";

export const metadata = canonicalMetadata("Reconciliation Time Calculator | InvoiceReconcile", "Estimate monthly manual reconciliation hours and annual labor cost using payment volume, minutes per match, and hourly cost.", "/tools/reconciliation-time-calculator");

export default function ReconciliationTimeCalculatorPage() {
  return <ToolShell title="Reconciliation time calculator" description="Estimate the current hours and labor cost spent manually matching incoming payments. Change any input to see the calculation immediately." note="The calculation runs in your browser and uses only the numbers you enter. It estimates current effort, not guaranteed product savings."><TimeCalculator /></ToolShell>;
}
