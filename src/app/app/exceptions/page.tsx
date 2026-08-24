import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, CircleAlert, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth/access";
import { demoClients } from "@/lib/demo/workspace";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type ExceptionWorkspace = {
  id: string;
  name: string;
  count: number | null;
  lastReconciled: string;
};

function count(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function completedLabel(value: unknown, timezone: unknown) {
  if (typeof value !== "string") return "Not run";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: typeof timezone === "string" ? timezone : "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  }
}

export default async function FirmExceptionInboxPage() {
  const user = await getCurrentUser({ allowPublicDemo: true });
  if (!user) redirect("/auth/sign-in?returnTo=/app/exceptions");
  let workspaces: ExceptionWorkspace[] = demoClients.map((client) => ({
    id: client.id,
    name: client.name,
    count: client.review,
    lastReconciled: client.lastReconciled,
  }));
  let demo = true;
  let loadUnavailable = false;

  if (user.source === "supabase") {
    demo = false;
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      workspaces = [];
      loadUnavailable = true;
    }
    else {
      const [workspaceResult, metricResult] = await Promise.all([
        supabase.from("workspaces").select("id,name,business_name,timezone").eq("status", "active").order("name"),
        supabase.rpc("get_workspace_portfolio_metrics"),
      ]);
      if (workspaceResult.error || metricResult.error || !Array.isArray(metricResult.data)) {
        workspaces = [];
        loadUnavailable = true;
      }
      else {
        const metrics = new Map<string, Record<string, unknown>>();
        for (const value of metricResult.data) {
          if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).workspace_id === "string") {
            metrics.set(String((value as Record<string, unknown>).workspace_id), value as Record<string, unknown>);
          }
        }
        workspaces = (workspaceResult.data || []).map((workspace) => {
          const metric = metrics.get(String(workspace.id));
          return {
            id: String(workspace.id),
            name: String(workspace.business_name || workspace.name),
            count: metric ? count(metric.payments_needing_review) : null,
            lastReconciled: metric ? completedLabel(metric.completed_at, workspace.timezone) : "Unavailable",
          };
        });
      }
    }
  }

  const unavailable = loadUnavailable || workspaces.some((workspace) => workspace.count === null);
  const actionable = workspaces
    .filter((workspace) => (workspace.count || 0) > 0)
    .sort((left, right) => (right.count || 0) - (left.count || 0) || left.name.localeCompare(right.name));
  const total = unavailable ? null : actionable.reduce((sum, workspace) => sum + (workspace.count || 0), 0);

  return <div className="min-h-screen bg-background"><header className="border-b bg-surface"><div className="page-shell flex h-16 items-center justify-between"><BrandLogo /><Link className="inline-flex items-center gap-2 text-sm font-semibold text-muted-strong hover:text-foreground" href="/app/workspaces"><ArrowLeft className="size-4" /> Client workspaces</Link></div></header><main className="page-shell py-10"><div className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Firm-wide queue</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Exceptions across all clients</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Start with the client workspaces that have unresolved review or unmatched payments. Financial decisions remain inside the correct client workspace.</p></div>{demo ? <span className="w-fit border border-info/25 bg-info-soft px-2 py-1 text-xs font-semibold text-info">Fictional portfolio</span> : null}</div>
    {unavailable ? <div className="mt-6 flex gap-3 border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="alert"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-semibold">The firm-wide total is temporarily unavailable.</p><p className="mt-1 text-muted-strong">Reload before relying on this queue. No client counts are being estimated.</p></div></div> : <section className="mt-6 border bg-surface p-5"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Needs review now</p><p className="numeric mt-2 text-4xl font-semibold text-warning">{total?.toLocaleString("en-US")}</p><p className="mt-2 text-sm text-muted">Across {actionable.length} {actionable.length === 1 ? "client workspace" : "client workspaces"}</p></section>}
    {actionable.length ? <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Client queues</h2><p className="mt-1 text-sm text-muted">Sorted by current exception count.</p></div><div className="divide-y">{actionable.map((workspace) => <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={workspace.id}><div className="flex min-w-0 items-center gap-3"><span className="inline-flex size-9 shrink-0 items-center justify-center bg-brand-soft text-brand"><Building2 className="size-4" /></span><div className="min-w-0"><p className="break-words font-semibold">{workspace.name}</p><p className="mt-1 text-xs text-muted">Last reconciled {workspace.lastReconciled}</p></div></div><span className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-warning"><CircleAlert className="size-4" />{workspace.count?.toLocaleString("en-US")} need review</span><Link href={`/app/${workspace.id}/exceptions`} className="inline-flex min-h-10 items-center justify-center gap-2 border border-brand bg-brand px-4 text-sm font-semibold text-white dark:text-[#10241b]">Open client queue <ArrowRight className="size-4" /></Link></div>)}</div></section> : !unavailable ? <section className="mt-6 border bg-surface p-8 text-center"><Check className="mx-auto size-7 text-success" /><h2 className="mt-3 font-semibold">{workspaces.length ? "No open exceptions across clients" : "No active client workspaces"}</h2><p className="mt-1 text-sm text-muted">{workspaces.length ? "Every latest saved run is clear or its review items have decisions." : "Add a client workspace before opening a firm-wide exception queue."}</p>{workspaces.length === 0 ? <Link className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 border border-brand px-4 text-sm font-semibold text-brand" href="/app/workspaces">Open client workspaces <ArrowRight className="size-4" /></Link> : null}</section> : null}
  </main></div>;
}
