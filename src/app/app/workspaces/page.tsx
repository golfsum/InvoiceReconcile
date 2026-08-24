import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, Check, CircleAlert, TriangleAlert } from "lucide-react";
import { CreateWorkspaceForm } from "@/components/app/create-workspace-form";
import { getCurrentUser } from "@/lib/auth/access";
import { demoClients } from "@/lib/demo/workspace";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type ClientRow = {
  id: string;
  name: string;
  imported: number | null;
  matched: number | null;
  review: number | null;
  lastReconciled: string;
};

type PortfolioMetricRow = {
  workspace_id?: unknown;
  payments_in_latest_run?: unknown;
  matched_payments?: unknown;
  payments_needing_review?: unknown;
  completed_at?: unknown;
};

function safeCount(value: unknown) {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function liveClientMetrics(data: PortfolioMetricRow | undefined, timezone = "UTC"): Omit<ClientRow, "id" | "name"> {
  if (!data) return { imported: null, matched: null, review: null, lastReconciled: "Temporarily unavailable" };
  const imported = safeCount(data.payments_in_latest_run);
  const matched = safeCount(data.matched_payments);
  const review = safeCount(data.payments_needing_review);
  if (imported === null || matched === null || review === null) {
    return { imported: null, matched: null, review: null, lastReconciled: "Temporarily unavailable" };
  }
  const completedAt = typeof data.completed_at === "string" ? data.completed_at : null;
  const completedDate = completedAt ? new Date(completedAt) : null;
  let lastReconciled = completedAt ? "Completed" : "Not run";
  if (completedDate && Number.isFinite(completedDate.getTime())) {
    try {
      lastReconciled = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timezone }).format(completedDate);
    } catch {
      lastReconciled = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(completedDate);
    }
  }
  return {
    imported,
    matched,
    review,
    lastReconciled,
  };
}

function metric(value: number | null) {
  return value === null ? <span className="text-muted">Unavailable</span> : value.toLocaleString("en-US");
}

function PortfolioUnavailable() {
  return <main className="min-h-screen bg-background px-4 py-8 sm:px-8"><div className="mx-auto max-w-6xl"><p className="eyebrow">Workspace portfolio</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Client workspaces</h1><div className="mt-6 flex gap-3 border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="alert"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-semibold">Workspace data is temporarily unavailable.</p><p className="mt-1 text-muted-strong">Retry before importing or reviewing client records.</p><Link className="mt-3 inline-flex font-semibold text-brand hover:underline" href="/app/workspaces">Retry workspace loading</Link></div></div></div></main>;
}

export default async function WorkspacesPage() {
  const user = await getCurrentUser({ allowPublicDemo: true });
  if (!user) redirect("/auth/sign-in?returnTo=/app/workspaces");
  let clients: ClientRow[] = demoClients.map((client) => ({ ...client }));
  let organizations: Array<{ id: string; name: string }> = [];
  let label = "Ledgerline Bookkeeping";
  let description = "Fictional sample data for the multi-client workflow.";
  let workspaceCreationUnavailable = false;

  if (user.source === "supabase") {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return <PortfolioUnavailable />;
    const [workspaceResult, organizationResult, membershipResult, portfolioResult] = await Promise.all([
      supabase.from("workspaces").select("id,business_name,name,timezone").eq("status", "active").order("name"),
      supabase.from("organizations").select("id,name").eq("status", "active").order("name"),
      supabase.from("memberships").select("organization_id,role").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "admin", "member"]),
      supabase.rpc("get_workspace_portfolio_metrics"),
    ]);
    if (workspaceResult.error) return <PortfolioUnavailable />;
    workspaceCreationUnavailable = Boolean(organizationResult.error || membershipResult.error);
    if (!workspaceCreationUnavailable) {
      const creatableOrganizationIds = new Set((membershipResult.data || []).map((membership) => String(membership.organization_id)));
      organizations = (organizationResult.data || [])
        .filter((organization) => creatableOrganizationIds.has(String(organization.id)))
        .map((organization) => ({ id: String(organization.id), name: String(organization.name) }));
    }
    const workspaceRows = workspaceResult.data || [];
    if (workspaceRows.length === 0 && workspaceCreationUnavailable) return <PortfolioUnavailable />;
    if (workspaceRows.length === 0 && (organizationResult.data || []).length === 0) redirect("/onboarding");
    const portfolioByWorkspace = new Map<string, PortfolioMetricRow>();
    if (!portfolioResult.error && Array.isArray(portfolioResult.data)) {
      for (const row of portfolioResult.data as PortfolioMetricRow[]) {
        if (typeof row.workspace_id === "string") portfolioByWorkspace.set(row.workspace_id, row);
      }
    }
    clients = workspaceRows.map((workspace) => ({
      id: String(workspace.id),
      name: String(workspace.business_name || workspace.name),
      ...liveClientMetrics(portfolioByWorkspace.get(String(workspace.id)), String(workspace.timezone || "UTC")),
    }));
    label = "Workspace portfolio";
    description = workspaceRows.length
      ? "Latest saved reconciliation status for each client workspace."
      : "This organization has no active workspace. Add a client workspace to continue.";
  }

  const totals = clients.reduce((value, client) => ({
    imported: value.imported + (client.imported || 0),
    matched: value.matched + (client.matched || 0),
    review: value.review + (client.review || 0),
  }), { imported: 0, matched: 0, review: 0 });
  const nextReview = clients.find((client) => (client.review || 0) > 0);
  const openWorkspaceHref = nextReview
    ? "/app/exceptions"
    : clients[0]
      ? `/app/${clients[0].id}`
      : null;
  const hasUnavailable = clients.some((client) => client.imported === null);
  const totalImported = hasUnavailable ? null : totals.imported;
  const totalMatched = hasUnavailable ? null : totals.matched;
  const totalReview = hasUnavailable ? null : totals.review;
  return <main className="min-h-screen bg-background px-4 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">{label}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Client workspaces</h1><p className="mt-2 text-sm text-muted">{description}</p></div>{openWorkspaceHref ? <Link href={openWorkspaceHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-brand bg-brand px-4 text-sm font-semibold text-white dark:text-[#10241b]">{nextReview ? hasUnavailable ? "Open firm-wide queue" : `Review ${totals.review} across all clients` : "Open a workspace"} <ArrowRight className="size-4" /></Link> : null}</div>
    {hasUnavailable ? <div className="mt-5 flex gap-3 border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="status"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><p>Some saved run totals could not be loaded. Retry before relying on the portfolio totals.</p></div> : null}
    <section className="mt-7 grid border bg-surface sm:grid-cols-3"><div className="border-b p-5 sm:border-r sm:border-b-0"><p className="text-xs text-muted">Payments in latest runs</p><p className="numeric mt-2 text-2xl font-semibold">{metric(totalImported)}</p></div><div className="border-b p-5 sm:border-r sm:border-b-0"><p className="text-xs text-muted">Matched in latest runs</p><p className="numeric mt-2 text-2xl font-semibold text-success">{metric(totalMatched)}</p></div><div className="p-5"><p className="text-xs text-muted">Needs review now</p><p className="numeric mt-2 text-2xl font-semibold text-warning">{metric(totalReview)}</p>{totalReview && totalReview > 0 ? <Link className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline" href="/app/exceptions">Open firm-wide queue <ArrowRight className="size-3.5" /></Link> : null}</div></section>
    {clients.length ? <section className="mt-6 overflow-x-auto border bg-surface"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">Client reconciliation status</caption><thead className="border-b bg-surface-muted text-xs uppercase tracking-[0.08em] text-muted"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3 text-right">Imported</th><th className="px-5 py-3 text-right">Matched</th><th className="px-5 py-3 text-right">Needs review</th><th className="px-5 py-3">Last reconciled</th><th className="px-5 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody className="divide-y">{clients.map((client) => <tr key={client.id} className="hover:bg-surface-muted"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="inline-flex size-8 items-center justify-center bg-brand-soft text-brand"><Building2 className="size-4" /></span><span className="font-semibold">{client.name}</span></div></td><td className="numeric px-5 py-4 text-right">{metric(client.imported)}</td><td className="numeric px-5 py-4 text-right">{metric(client.matched)}</td><td className="numeric px-5 py-4 text-right">{client.review === null ? <span className="text-muted">Unavailable</span> : client.review ? <span className="inline-flex items-center gap-1 text-warning"><CircleAlert className="size-4" />{client.review}</span> : <span className="inline-flex items-center gap-1 text-success"><Check className="size-4" />0</span>}</td><td className="px-5 py-4 text-muted">{client.lastReconciled}</td><td className="px-5 py-4 text-right"><Link href={`/app/${client.id}`} className="font-semibold text-brand hover:underline">Open</Link></td></tr>)}</tbody></table></section> : <section className="mt-6 border bg-surface p-6"><div className="flex gap-3"><span className="inline-flex size-9 shrink-0 items-center justify-center bg-brand-soft text-brand"><Building2 className="size-4" /></span><div><h2 className="font-semibold">No active workspaces</h2><p className="mt-1 text-sm text-muted">{organizations.length ? "Create a workspace below to keep this organization, subscription, and billing history together." : "Your organization role cannot create a workspace. Ask an owner or admin for help."}</p></div></div></section>}
    {user.source === "supabase" && organizations.length ? <CreateWorkspaceForm organizations={organizations} /> : null}
    {user.source === "supabase" && workspaceCreationUnavailable ? <div className="mt-6 border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="status">Workspace creation is temporarily unavailable. Existing workspace access is unaffected.</div> : null}
  </div></main>;
}
