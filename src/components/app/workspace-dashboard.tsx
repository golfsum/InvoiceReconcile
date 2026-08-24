import Link from "next/link";
import { AlertTriangle, ArrowRight, FileInput, Scale } from "lucide-react";
import { money, shortDate } from "@/lib/demo/workspace";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { StoredWorkspaceData } from "@/lib/reconciliation/workspace-data";
import type { LargeRunOverview } from "@/lib/reconciliation/large-run";

export function WorkspaceDashboard({ workspaceId, workspaceName, data }: { workspaceId: string; workspaceName: string; data: StoredWorkspaceData | null }) {
  if (!data) {
    return <div className="mx-auto max-w-3xl border bg-surface p-8 text-center"><FileInput className="mx-auto size-8 text-brand" /><h1 className="mt-4 text-2xl font-semibold">No reconciliation run yet</h1><p className="mt-2 text-sm text-muted">Import open invoices and incoming payments to create this workspace&apos;s first reconciliation overview.</p><Link href={`/app/${workspaceId}/imports`} className={cn(buttonVariants({ variant: "primary" }), "mt-5")}>Import files</Link></div>;
  }

  const decisions = data.decisions || {};
  const confirmed = data.result.matches.filter((match) => decisions[match.id]?.outcome === "confirmed").length;
  const suggested = data.result.matches.filter((match) => !decisions[match.id] && (match.confidence === "exact" || match.confidence === "high_confidence")).length;
  const review = data.result.matches.filter((match) => !decisions[match.id] && match.confidence === "review").length;
  const unmatched = data.result.matches.filter((match) => decisions[match.id]?.outcome === "rejected" || decisions[match.id]?.outcome === "unmatched" || (!decisions[match.id] && match.confidence === "unmatched")).length;
  const completionRate = data.result.matches.length ? confirmed / data.result.matches.length : 0;
  const reviewItems = data.result.matches.filter((match) => !decisions[match.id] && (match.confidence === "review" || match.confidence === "unmatched")).slice(0, 4);
  const exceptionCount = data.result.matches.filter((match) => !decisions[match.id] && (match.confidence === "review" || match.confidence === "unmatched")).length;
  const paymentById = new Map(data.payments.map((payment) => [payment.id, payment]));
  const currency = data.invoices[0]?.currency || data.payments[0]?.currency || "USD";
  const sourceFiles = data.sourceFiles;
  const completedLabel = data.completedAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(data.completedAt)) : "Latest run";
  const segmentWidth = (count: number) => data.result.matches.length ? `${(count / data.result.matches.length) * 100}%` : "0%";

  return (
    <div className="mx-auto max-w-[1260px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">Latest run</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Reconciliation overview</h1><p className="mt-2 text-sm text-muted">{workspaceName} · {currency} · {completedLabel}</p></div>
        <div className="flex gap-2"><Link href={`/app/${workspaceId}/imports`} className={buttonVariants({ variant: "secondary" })}><FileInput className="size-4" /> Import</Link><Link href={`/app/${workspaceId}/exceptions`} className={buttonVariants({ variant: "primary" })}><Scale className="size-4" /> Review {exceptionCount} exceptions</Link></div>
      </div>

      <section aria-label="Reconciliation totals" className="mt-7 grid border bg-surface sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Open invoice balance", money(data.invoices.reduce((sum, invoice) => sum + invoice.outstandingAmountMinor, 0), currency), "balance"],
          ["Payments imported", data.payments.length.toString(), "imported"],
          ["Confirmed applications", confirmed.toString(), "confirmed"],
          ["Needs review", review.toString(), "review"],
          ["Unmatched", unmatched.toString(), "unmatched"],
        ].map(([label, value, key], index) => (
          <div key={key} className={cn("p-5", index < 4 ? "xl:border-r" : "", index < 4 ? "border-b xl:border-b-0" : "")}><p className="text-xs font-semibold text-muted">{label}</p><p className="numeric mt-3 text-2xl font-semibold tracking-tight">{value}</p></div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="border bg-surface">
          <div className="flex items-start justify-between gap-4 border-b p-5"><div><h2 className="font-semibold">Decision progress</h2><p className="mt-1 text-sm text-muted">{Math.round(completionRate * 100)}% of proposed payment results have a confirmed application.</p></div><span className="numeric text-2xl font-semibold text-success">{Math.round(completionRate * 100)}%</span></div>
          <div className="p-5">
            <div className="flex h-3 overflow-hidden bg-surface-muted" aria-label={`${confirmed} confirmed, ${suggested} suggested, ${review} review, ${unmatched} unmatched`}><span className="bg-success" style={{ width: segmentWidth(confirmed) }} /><span className="bg-[#6dbd98]" style={{ width: segmentWidth(suggested) }} /><span className="bg-warning" style={{ width: segmentWidth(review) }} /><span className="bg-border-strong" style={{ width: segmentWidth(unmatched) }} /></div>
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[["Confirmed", confirmed, "bg-success"], ["Suggested", suggested, "bg-[#6dbd98]"], ["Review", review, "bg-warning"], ["Unmatched", unmatched, "bg-border-strong"]].map(([label, value, color]) => <div key={label as string}><dt className="flex items-center gap-2 text-xs text-muted"><span className={cn("size-2", color as string)} />{label}</dt><dd className="numeric mt-1 text-lg font-semibold">{value as number}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="border bg-surface">
          <div className="border-b p-5"><h2 className="font-semibold">Source imports</h2></div>
          {sourceFiles ? <ul className="divide-y">
            {[sourceFiles.payment, sourceFiles.invoice].map((file) => <li key={file.name} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{file.name}</p><p className="mt-1 text-xs text-muted">{file.accepted} accepted · {file.rejected} rejected</p></div><StatusBadge status={file.rejected ? "review" : "exact"} label={file.rejected ? "Completed with issues" : "Processed"} /></li>)}
          </ul> : <p className="p-5 text-sm text-muted">Source file details were not retained in this older run.</p>}
          <Link className="flex items-center gap-2 border-t p-4 text-sm font-semibold text-brand hover:bg-surface-muted" href={`/app/${workspaceId}/imports`}>View imports <ArrowRight className="size-4" /></Link>
        </section>
      </div>

      <section className="mt-6 border bg-surface">
        <div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">Open exceptions</h2><p className="mt-1 text-sm text-muted">Only payment results without a saved decision appear here.</p></div><Link href={`/app/${workspaceId}/exceptions`} className="text-sm font-semibold text-brand hover:underline">Open queue</Link></div>
        {reviewItems.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Payer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Payment</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">
          {reviewItems.map((match) => { const payment = paymentById.get(match.paymentIds[0]); return <tr key={match.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-semibold">{payment?.payerName || "Unknown payer"}</td><td className="px-5 py-4 text-muted">{payment ? shortDate(payment.paymentDate) : ""}</td><td className="numeric px-5 py-4 font-semibold">{money(match.paymentAmountMinor)}</td><td className="px-5 py-4 capitalize text-muted">{match.method.replaceAll("_", " ")}</td><td className="px-5 py-4"><StatusBadge status={match.confidence === "review" ? "review" : "unmatched"} /></td></tr>; })}
        </tbody></table></div> : <div className="p-8 text-center"><AlertTriangle className="mx-auto size-6 text-success" /><p className="mt-3 text-sm font-semibold">No open exceptions</p><p className="mt-1 text-xs text-muted">Every review-status and unmatched result has a saved decision.</p></div>}
      </section>
    </div>
  );
}

export function LargeWorkspaceDashboard({ workspaceId, workspaceName, overview }: { workspaceId: string; workspaceName: string; overview: LargeRunOverview }) {
  const { metrics } = overview;
  const completionRate = metrics.matches ? metrics.confirmed / metrics.matches : 0;
  const completedLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(overview.completedAt));
  const segmentWidth = (count: number) => metrics.matches ? `${(count / metrics.matches) * 100}%` : "0%";
  return <div className="mx-auto max-w-[1260px]">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Latest run</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Reconciliation overview</h1><p className="mt-2 text-sm text-muted">{workspaceName} · {overview.currency} · {completedLabel}</p></div><div className="flex gap-2"><Link href={`/app/${workspaceId}/imports`} className={buttonVariants({ variant: "secondary" })}><FileInput className="size-4" /> Import</Link><Link href={`/app/${workspaceId}/exceptions`} className={buttonVariants({ variant: "primary" })}><Scale className="size-4" /> Review {metrics.exceptions} exceptions</Link></div></div>
    <section aria-label="Reconciliation totals" className="mt-7 grid border bg-surface sm:grid-cols-2 xl:grid-cols-5">{[
      ["Open invoice balance", money(metrics.openInvoiceBalanceMinor, overview.currency), "balance"],
      ["Payments imported", metrics.payments.toString(), "imported"],
      ["Confirmed applications", metrics.confirmed.toString(), "confirmed"],
      ["Needs review", metrics.review.toString(), "review"],
      ["Unmatched", metrics.unmatched.toString(), "unmatched"],
    ].map(([label, value, key], index) => <div key={key} className={cn("p-5", index < 4 ? "xl:border-r" : "", index < 4 ? "border-b xl:border-b-0" : "")}><p className="text-xs font-semibold text-muted">{label}</p><p className="numeric mt-3 text-2xl font-semibold tracking-tight">{value}</p></div>)}</section>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]"><section className="border bg-surface"><div className="flex items-start justify-between gap-4 border-b p-5"><div><h2 className="font-semibold">Decision progress</h2><p className="mt-1 text-sm text-muted">{Math.round(completionRate * 100)}% of proposed payment results have a confirmed application.</p></div><span className="numeric text-2xl font-semibold text-success">{Math.round(completionRate * 100)}%</span></div><div className="p-5"><div className="flex h-3 overflow-hidden bg-surface-muted" aria-label={`${metrics.confirmed} confirmed, ${metrics.suggested} suggested, ${metrics.review} review, ${metrics.unmatched} unmatched`}><span className="bg-success" style={{ width: segmentWidth(metrics.confirmed) }} /><span className="bg-[#6dbd98]" style={{ width: segmentWidth(metrics.suggested) }} /><span className="bg-warning" style={{ width: segmentWidth(metrics.review) }} /><span className="bg-border-strong" style={{ width: segmentWidth(metrics.unmatched) }} /></div><dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Confirmed", metrics.confirmed, "bg-success"], ["Suggested", metrics.suggested, "bg-[#6dbd98]"], ["Review", metrics.review, "bg-warning"], ["Unmatched", metrics.unmatched, "bg-border-strong"]].map(([label, value, color]) => <div key={label as string}><dt className="flex items-center gap-2 text-xs text-muted"><span className={cn("size-2", color as string)} />{label}</dt><dd className="numeric mt-1 text-lg font-semibold">{value as number}</dd></div>)}</dl></div></section>
      <section className="border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Source imports</h2></div>{overview.sourceFiles ? <ul className="divide-y">{[overview.sourceFiles.payment, overview.sourceFiles.invoice].map((file) => <li key={file.name} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{file.name}</p><p className="mt-1 text-xs text-muted">{file.accepted} accepted · {file.rejected} rejected</p></div><StatusBadge status={file.rejected ? "review" : "exact"} label={file.rejected ? "Completed with issues" : "Processed"} /></li>)}</ul> : <p className="p-5 text-sm text-muted">Source file details were not retained for this run.</p>}<Link className="flex items-center gap-2 border-t p-4 text-sm font-semibold text-brand hover:bg-surface-muted" href={`/app/${workspaceId}/imports`}>View imports <ArrowRight className="size-4" /></Link></section>
    </div>
    <section className="mt-6 border bg-surface"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">Open exceptions</h2><p className="mt-1 text-sm text-muted">A bounded preview is shown here. Open the queue to search and page through every result.</p></div><Link href={`/app/${workspaceId}/exceptions`} className="text-sm font-semibold text-brand hover:underline">Open queue</Link></div>{overview.preview.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Payer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Payment</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">{overview.preview.map(({ match, payment }) => <tr key={match.id} className="hover:bg-surface-muted"><td className="px-5 py-4 font-semibold">{payment?.payerName || "Unknown payer"}</td><td className="px-5 py-4 text-muted">{payment ? shortDate(payment.paymentDate) : ""}</td><td className="numeric px-5 py-4 font-semibold">{money(match.paymentAmountMinor, payment?.currency)}</td><td className="px-5 py-4 capitalize text-muted">{match.method.replaceAll("_", " ")}</td><td className="px-5 py-4"><StatusBadge status={match.confidence === "review" ? "review" : "unmatched"} /></td></tr>)}</tbody></table></div> : <div className="p-8 text-center"><AlertTriangle className="mx-auto size-6 text-success" /><p className="mt-3 text-sm font-semibold">No open exceptions</p><p className="mt-1 text-xs text-muted">Every review-status and unmatched result has a saved decision.</p></div>}</section>
  </div>;
}
