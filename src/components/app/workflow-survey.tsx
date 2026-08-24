"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const options = [["quickbooks_manually", "QuickBooks manually"], ["excel", "Excel"], ["google_sheets", "Google Sheets"], ["xero_manually", "Xero manually"], ["accountant_bookkeeper", "Accountant or bookkeeper"], ["other", "Other"]] as const;

export function PriorWorkflowSurvey({ workspaceId }: { workspaceId: string }) {
  const storageKey = `ir_prior_workflow_${workspaceId}_v1`;
  const [choice, setChoice] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSubmitted(window.localStorage.getItem(storageKey) === "1");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);
  if (submitted) return <div className="mx-auto mt-5 flex max-w-[1460px] items-center gap-2 border border-success/25 bg-success-soft p-4 text-sm font-medium text-success"><Check className="size-4" />Thanks. This answer helps prioritize the import paths that matter.</div>;

  async function submit() {
    if (!choice) return;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId);
    const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ priorWorkflow: choice, workspaceId: isUuid ? workspaceId : undefined }) });
    if (!response.ok) { toast.error("Feedback could not be saved right now."); return; }
    window.localStorage.setItem(storageKey, "1");
    setSubmitted(true);
  }

  return <section className="mx-auto mt-5 max-w-[1460px] border bg-surface p-5"><p className="text-sm font-semibold">What were you using before InvoiceReconcile?</p><p className="mt-1 text-xs text-muted">One answer after the first result. No financial details are attached.</p><div className="mt-4 flex flex-wrap gap-2">{options.map(([value, label]) => <button type="button" key={value} onClick={() => setChoice(value)} className={`border px-3 py-2 text-sm font-medium ${choice === value ? "border-brand bg-brand-soft text-brand" : "bg-background text-muted-strong"}`}>{label}</button>)}<Button size="sm" disabled={!choice} onClick={() => void submit()}>Save answer</Button></div></section>;
}
