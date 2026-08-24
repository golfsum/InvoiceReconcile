"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  FileWarning,
  Gauge,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  Search,
  ShieldCheck,
  Database,
  TrendingUp,
  UserPlus,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActivitySeverity,
  AdminMetrics,
  AdminUserRecord,
  DailyAdminMetric,
  FunnelStage,
  SubscriptionStatus,
} from "@/lib/admin/types";

type RangeKey = "7d" | "30d" | "90d" | "all";
type UserStatusFilter = "all" | SubscriptionStatus;

export interface AdminDashboardProps {
  metrics: AdminMetrics;
  operatorName?: string;
}

const numberFormat = new Intl.NumberFormat("en-US");
const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactCurrencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactNumberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const rangeOptions: Array<{ key: RangeKey; label: string; days?: number }> = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "all", label: "All available" },
];

const statusLabel: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
};

const severityStyles: Record<ActivitySeverity, string> = {
  info: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
};

const formatCurrency = (cents: number) => currencyFormat.format(cents / 100);
const formatCompactCurrency = (cents: number) =>
  compactCurrencyFormat.format(cents / 100);
const formatPercent = (rate: number, digits = 1) =>
  `${(rate * 100).toFixed(digits)}%`;
const formatDate = (value: string) => dateFormat.format(new Date(value));
const formatShortDate = (value: string) => shortDateFormat.format(new Date(value));
const formatTime = (value: string) => timeFormat.format(new Date(value));

const sum = (points: DailyAdminMetric[], key: keyof DailyAdminMetric) =>
  points.reduce((total, point) => total + Number(point[key]), 0);

const rate = (value: number, total: number) => (total > 0 ? value / total : 0);

function buildPeriodFunnel(points: DailyAdminMetric[]): FunnelStage[] {
  const counts = [
    sum(points, "visitors"),
    sum(points, "signupStarts"),
    sum(points, "signups"),
    sum(points, "activations"),
    sum(points, "subscriptions"),
  ];
  const stages: Array<Pick<FunnelStage, "key" | "label">> = [
    { key: "visitors", label: "Visitors" },
    { key: "started", label: "Signup started" },
    { key: "signed_up", label: "Signed up" },
    { key: "activated", label: "Activated" },
    { key: "subscribed", label: "Subscribed" },
  ];
  return stages.map((stage, index) => ({
    ...stage,
    count: counts[index],
    fromPreviousRate: index === 0 ? 1 : rate(counts[index], counts[index - 1]),
    overallRate: rate(counts[index], counts[0]),
  }));
}

function compare(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 1 : 0;
  return (current - previous) / previous;
}

function MetricCard({
  label,
  value,
  detail,
  trend,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: string;
  detail: string;
  trend?: number;
  icon: LucideIcon;
  tone?: "brand" | "emerald" | "amber";
}) {
  const toneStyles = {
    brand: "bg-[#e8f3ed] text-[#176b4d]",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  const trendUp = (trend ?? 0) >= 0;
  return (
    <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center border border-current/10 ${toneStyles[tone]}`}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
      </div>
      <div className="mt-4 flex min-h-5 items-center gap-1.5 text-xs text-slate-600">
        {trend !== undefined ? (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${trendUp ? "text-emerald-700" : "text-rose-700"}`}>
            {trendUp ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(trend * 100).toFixed(1)}%
          </span>
        ) : null}
        <span>{detail}</span>
      </div>
    </article>
  );
}

function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const styles: Record<SubscriptionStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    trialing: "bg-[#e8f3ed] text-[#176b4d] ring-[#b9d8c8]",
    past_due: "bg-amber-50 text-amber-800 ring-amber-200",
    canceled: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return (
    <span className={`inline-flex px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 py-10 text-center">
      <div>
        <Search className="mx-auto size-7 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{detail}</p>
      </div>
    </div>
  );
}

function UserTable({ users }: { users: AdminUserRecord[] }) {
  if (users.length === 0) {
    return <EmptyState title="No signups match" detail="Try a broader date range, status, or search term." />;
  }
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Signup history table">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
            <th className="px-5 py-3">User</th>
            <th className="px-5 py-3">Plan</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Acquired</th>
            <th className="px-5 py-3">Signed up</th>
            <th className="px-5 py-3">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user.id} className="transition-colors hover:bg-slate-50/80">
              <td className="px-5 py-3.5">
                <div className="font-semibold text-slate-800">{user.displayName}</div>
                <div className="mt-0.5 text-xs text-slate-600">{user.maskedEmail}</div>
              </td>
              <td className="px-5 py-3.5 capitalize text-slate-600">{user.plan}</td>
              <td className="px-5 py-3.5"><StatusBadge status={user.subscriptionStatus} /></td>
              <td className="px-5 py-3.5 text-slate-600">{user.source}</td>
              <td className="px-5 py-3.5 text-slate-600">{formatDate(user.signedUpAt)}</td>
              <td className="px-5 py-3.5 text-slate-600">
                {user.lastActiveAt ? formatDate(user.lastActiveAt) : "Not yet"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard({ metrics, operatorName = "Admin" }: AdminDashboardProps) {
  const [range, setRange] = useState<RangeKey>("30d");
  const [query, setQuery] = useState("");
  const [userStatus, setUserStatus] = useState<UserStatusFilter>("all");

  const selectedRange = rangeOptions.find((option) => option.key === range)!;
  const filteredDaily = useMemo(
    () => selectedRange.days ? metrics.daily.slice(-selectedRange.days) : metrics.daily,
    [metrics.daily, selectedRange.days],
  );
  const previousDaily = useMemo(() => {
    if (!selectedRange.days) return [];
    const start = Math.max(0, metrics.daily.length - selectedRange.days * 2);
    const end = Math.max(0, metrics.daily.length - selectedRange.days);
    return metrics.daily.slice(start, end);
  }, [metrics.daily, selectedRange.days]);

  const periodStart = filteredDaily[0]?.date ?? metrics.coverage.from;
  const periodEnd = filteredDaily.at(-1)?.date ?? metrics.coverage.to;
  const periodFunnel = useMemo(() => buildPeriodFunnel(filteredDaily), [filteredDaily]);
  const periodReconciliation = useMemo(() => {
    const processed = sum(filteredDaily, "processed");
    return {
      importsCompleted: sum(filteredDaily, "importsCompleted"),
      processed,
      autoMatched: sum(filteredDaily, "autoMatched"),
      sentToReview: sum(filteredDaily, "sentToReview"),
      rejected: sum(filteredDaily, "rejected"),
    };
  }, [filteredDaily]);
  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return metrics.users.filter((user) => {
      const signedUp = user.signedUpAt.slice(0, 10);
      const inPeriod = signedUp >= periodStart.slice(0, 10) && signedUp <= periodEnd.slice(0, 10);
      const hasStatus = userStatus === "all" || user.subscriptionStatus === userStatus;
      const matchesQuery =
        !normalizedQuery ||
        `${user.displayName} ${user.maskedEmail} ${user.source} ${user.plan}`
          .toLowerCase()
          .includes(normalizedQuery);
      return inPeriod && hasStatus && matchesQuery;
    });
  }, [metrics.users, periodEnd, periodStart, query, userStatus]);
  const visibleActivity = metrics.activity.filter((item) => {
    const occurred = item.occurredAt.slice(0, 10);
    return occurred >= periodStart.slice(0, 10) && occurred <= periodEnd.slice(0, 10);
  });
  const visitors = sum(filteredDaily, "visitors");
  const signups = sum(filteredDaily, "signups");
  const previousVisitors = sum(previousDaily, "visitors");
  const previousSignups = sum(previousDaily, "signups");
  const previousProcessed = sum(previousDaily, "processed");
  const failedJobs = sum(filteredDaily, "failedJobs");
  const chartData = filteredDaily.map((point) => ({
    ...point,
    label: formatShortDate(point.date),
  }));
  const activeRetention = metrics.retention.slice(-5);

  return (
    <div className="min-h-screen bg-[#f4f6f2] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center bg-[#176b4d] text-white">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">InvoiceReconcile</p>
              <p className="text-xs text-slate-600">Internal operations</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {metrics.dataMode === "demo" ? (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                <Database className="size-3.5" /> Demo data
              </span>
            ) : metrics.dataMode === "live" ? (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <span className="size-1.5 bg-emerald-500" /> Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                <AlertCircle className="size-3.5" /> Data unavailable
              </span>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-800">{operatorName}</p>
              <p className="text-xs text-slate-600">Authorized staff</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-slate-200 bg-white px-4 py-6 lg:block">
          <nav aria-label="Admin sections" className="sticky top-24 space-y-1">
            {[
              ["#overview", "Overview", LayoutDashboard],
              ["#growth", "Growth & revenue", TrendingUp],
              ["#customers", "Customers", Users],
              ["#operations", "Reconciliation", Gauge],
              ["#health", "Platform health", Activity],
            ].map(([href, label, Icon], index) => {
              const NavIcon = Icon as LucideIcon;
              return (
                <a
                  key={String(href)}
                  href={String(href)}
                  className={`flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm font-medium transition-colors ${index === 0 ? "border-[#176b4d] bg-[#e8f3ed] text-slate-950" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                >
                  <NavIcon className="size-4" /> {String(label)}
                </a>
              );
            })}
            <div className="mt-8 border border-[#b9d8c8] bg-[#e8f3ed] p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#176b4d]">Privacy note</p>
              <p className="mt-2 text-xs leading-5 text-slate-700">
                Activity is minimized. Emails are masked and customer invoice values are never shown.
              </p>
            </div>
          </nav>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <section id="overview" className="scroll-mt-24">
            <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
              <div>
                <p className="text-sm font-medium text-[#176b4d]">Operations snapshot</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Know what is growing and what needs attention.</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Updated {formatTime(metrics.generatedAt)}. Selected period: {formatShortDate(periodStart)} to {formatShortDate(periodEnd)}.
                </p>
              </div>
              <label className="relative w-full sm:w-52">
                <span className="sr-only">Dashboard date range</span>
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as RangeKey)}
                  className="h-11 w-full appearance-none border border-slate-300 bg-white pl-10 pr-9 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#176b4d] focus:ring-2 focus:ring-[#b9d8c8]"
                >
                  {rangeOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
                <ChevronRight className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 rotate-90 text-slate-600" />
              </label>
            </div>

            {metrics.dataMode === "unavailable" ? (
              <div className="mt-5 flex gap-3 border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-semibold">Live operations data is unavailable</p>
                  <p className="mt-1 leading-6">{metrics.availabilityMessage || "The metrics connection could not be read. No demo values are being substituted."}</p>
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <MetricCard label="Monthly recurring revenue" value={formatCurrency(metrics.mrr.totalMrrCents)} detail={`${metrics.mrr.payingSubscriptions} paying organizations`} icon={BadgeDollarSign} tone="emerald" />
              <MetricCard label="New signups" value={numberFormat.format(signups)} detail="vs. prior period" trend={previousDaily.length ? compare(signups, previousSignups) : undefined} icon={UserPlus} tone="brand" />
              <MetricCard label="Unique visitors" value={compactNumberFormat.format(visitors)} detail="vs. prior period" trend={previousDaily.length ? compare(visitors, previousVisitors) : undefined} icon={Users} tone="brand" />
              <MetricCard label="Records reconciled" value={compactNumberFormat.format(periodReconciliation.processed)} detail="vs. prior period" trend={previousDaily.length ? compare(periodReconciliation.processed, previousProcessed) : undefined} icon={CircleGauge} tone="amber" />
            </div>
          </section>

          <section id="growth" className="mt-6 grid scroll-mt-24 gap-6 2xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.8fr)]">
            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Acquisition activity" detail="Observed visitors and completed signups in the selected period." />
              {chartData.length ? (
                <figure className="mt-6 h-72 w-full" aria-label="Visitor and signup activity chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "#475569", fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compactNumberFormat.format(value)} tick={{ fill: "#475569", fontSize: 11 }} />
                      <Tooltip formatter={(value) => numberFormat.format(Number(value))} labelStyle={{ color: "#475569", fontWeight: 600 }} contentStyle={{ borderRadius: 0, borderColor: "#e2e8f0", boxShadow: "0 10px 30px rgba(15,23,42,.08)" }} />
                      <Area type="monotone" dataKey="visitors" name="Visitors" stroke="#176b4d" strokeWidth={2.5} fill="#dceee5" />
                      <Area type="monotone" dataKey="signups" name="Signups" stroke="#a46216" strokeWidth={2} fill="#f9e7c5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </figure>
              ) : <EmptyState title="No trend data" detail="Metrics for this period have not arrived yet." />}
              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
                {metrics.mrr.byPlan.map((plan) => (
                  <div key={plan.plan} className="border-l-2 border-[#b9d8c8] bg-slate-50 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold capitalize text-slate-600">{plan.plan}</p>
                      <p className="text-xs font-medium text-slate-600">{formatPercent(plan.share, 0)}</p>
                    </div>
                    <p className="mt-1.5 text-lg font-semibold text-slate-900">{formatCompactCurrency(plan.mrrCents)}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{plan.subscriptions} subscriptions</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Conversion funnel" detail={`${selectedRange.label}. Rates are stage to stage.`} />
              <div className="mt-6 space-y-5">
                {periodFunnel.map((stage, index) => (
                  <div key={stage.key}>
                    <div className="mb-2 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{stage.label}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{numberFormat.format(stage.count)} people</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">{index === 0 ? "Baseline" : formatPercent(stage.fromPreviousRate)}</span>
                    </div>
                    <div className="h-2 overflow-hidden bg-slate-100">
                      <div className="h-full bg-[#176b4d]" style={{ width: `${Math.max(stage.overallRate * 100, stage.count ? 3 : 0)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-xs font-medium text-slate-600">Activation rate</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{formatPercent(metrics.activation.activationRate)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-600">Median time to value</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">{metrics.activation.medianTimeToValueMinutes === null ? "No data" : `${metrics.activation.medianTimeToValueMinutes} min`}</p>
                </div>
              </div>
            </article>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-3">
            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Acquisition quality" detail="Observed consented visits only. Unavailable means no measured visit was linked to that signup source." />
              <div className="mt-5 overflow-x-auto" tabIndex={0} aria-label="Acquisition quality table">
                <table className="w-full min-w-[530px] text-left text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600"><th className="pb-3">Source</th><th className="pb-3 text-right">Visitors</th><th className="pb-3 text-right">Signups</th><th className="pb-3 text-right">Signup rate</th><th className="pb-3 text-right">Paid rate</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {metrics.acquisition.map((source) => (
                      <tr key={source.source}><td className="py-3 font-semibold text-slate-700">{source.source}</td><td className="py-3 text-right text-slate-600">{source.visitors === null ? "Unavailable" : numberFormat.format(source.visitors)}</td><td className="py-3 text-right text-slate-600">{source.signups}</td><td className="py-3 text-right font-medium text-slate-700">{source.visitorToSignupRate === null ? "Unavailable" : formatPercent(source.visitorToSignupRate)}</td><td className="py-3 text-right font-medium text-slate-700">{formatPercent(source.signupToPaidRate)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Support queue" detail="Stored contact requests and notification delivery state." action={<span className="inline-flex items-center gap-1.5 bg-[#e8f3ed] px-2.5 py-1.5 text-xs font-semibold text-[#176b4d]"><Mail className="size-3.5" /> {metrics.contactRequests.filter((item) => item.status === "new").length} new</span>} />
              {metrics.contactRequests.length ? (
                <div className="mt-5 space-y-3">
                  {metrics.contactRequests.slice(0, 5).map((request) => (
                    <article key={request.id} className="border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{request.subject}</p><span className={request.deliveryStatus === "failed" ? "bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700" : "bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600"}>{request.deliveryStatus}</span></div>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{request.excerpt}</p>
                      <footer className="mt-3 flex items-center justify-between gap-3 text-[11px] text-slate-600"><span>{request.maskedEmail}</span><span>{formatTime(request.occurredAt)} · {request.status}</span></footer>
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="No support requests" detail="Validated contact submissions will appear here." />}
            </article>

            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Cohort retention" detail="Weekly active users from each signup cohort." />
              {activeRetention.length ? (
                <div className="mt-5 overflow-x-auto" tabIndex={0} aria-label="Retention cohort table">
                  <table className="w-full min-w-[500px] text-sm">
                    <thead><tr className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600"><th className="pb-3 text-left">Cohort</th><th className="pb-3">Users</th>{[0, 1, 2, 3].map((week) => <th key={week} className="pb-3">W{week}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeRetention.map((cohort) => (
                        <tr key={cohort.cohortStart}><td className="py-3 text-left font-semibold text-slate-700">{formatShortDate(cohort.cohortStart)}</td><td className="py-3 text-center text-slate-600">{cohort.cohortSize}</td>{cohort.retentionRateByWeek.map((retentionRate, index) => <td key={index} className="p-1.5 text-center"><span className="block border border-[#b9d8c8] px-2 py-2 text-xs font-semibold text-[#164e3b]" style={{ backgroundColor: `rgba(23,107,77,${Math.max(0.06, retentionRate * 0.28)})` }}>{formatPercent(retentionRate, 0)}</span></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState title="No retention cohorts" detail="Cohorts will appear after the first signup." />}
            </article>
          </section>

          <section id="customers" className="mt-6 scroll-mt-24 border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="p-5 sm:p-6">
              <SectionHeading
                title="Signups and customer history"
                detail={`${visibleUsers.length} matching users. Contact data stays masked in this view.`}
                action={<div className="flex flex-wrap gap-2"><span className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">{metrics.organizations.total} organizations</span><span className="border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">{metrics.organizations.connectedSystems} connections</span></div>}
              />
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <label className="relative flex-1">
                  <span className="sr-only">Search signups</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, masked email, source, or plan" className="h-10 w-full border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-600 focus:border-[#176b4d] focus:ring-2 focus:ring-[#b9d8c8]" />
                </label>
                <select value={userStatus} onChange={(event) => setUserStatus(event.target.value as UserStatusFilter)} aria-label="Filter signups by subscription status" className="h-10 border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#176b4d] focus:ring-2 focus:ring-[#b9d8c8]">
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="trialing">Trial</option>
                  <option value="past_due">Past due</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>
            </div>
            <UserTable users={visibleUsers} />
          </section>

          <section id="operations" className="mt-6 grid scroll-mt-24 gap-6 2xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.85fr)]">
            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Reconciliation throughput" detail={`${numberFormat.format(periodReconciliation.processed)} records processed in the selected period.`} />
              <div className="mt-6 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "#475569", fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compactNumberFormat.format(value)} tick={{ fill: "#475569", fontSize: 11 }} />
                    <Tooltip formatter={(value, name) => [numberFormat.format(Number(value)), String(name)]} contentStyle={{ borderRadius: 0, borderColor: "#e2e8f0" }} />
                    <Bar dataKey="autoMatched" name="Auto-matched" stackId="status" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="sentToReview" name="Review" stackId="status" fill="#f59e0b" />
                    <Bar dataKey="rejected" name="Rejected" stackId="status" fill="#f43f5e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[
                  ["Imports", periodReconciliation.importsCompleted, FileWarning, "text-[#176b4d]", "bg-[#e8f3ed]"],
                  ["Auto-match", periodReconciliation.autoMatched, CheckCircle2, "text-emerald-700", "bg-emerald-50"],
                  ["Review", periodReconciliation.sentToReview, AlertCircle, "text-amber-700", "bg-amber-50"],
                  ["Rejected", periodReconciliation.rejected, XCircle, "text-rose-700", "bg-rose-50"],
                  ["Processing failures", failedJobs, XCircle, "text-slate-700", "bg-slate-100"],
                ].map(([label, count, Icon, iconColor, iconBg]) => {
                  const ItemIcon = Icon as LucideIcon;
                  const absolute = String(label) === "Imports" || String(label) === "Processing failures";
                  return <div key={String(label)} className="border border-slate-200 p-3"><span className={`grid size-8 place-items-center ${iconBg} ${iconColor}`}><ItemIcon className="size-4" /></span><p className="mt-2 text-xs font-medium text-slate-600">{String(label)}</p><p className="mt-1 text-lg font-semibold text-slate-900">{absolute ? numberFormat.format(Number(count)) : formatPercent(rate(Number(count), periodReconciliation.processed))}</p></div>;
                })}
              </div>
            </article>

            <article id="health" className="scroll-mt-24 border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Platform health" detail="Open failures and import exceptions." action={<span className={`px-2.5 py-1 text-xs font-semibold ${metrics.operationalIssues.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{metrics.operationalIssues.length} open</span>} />
              {metrics.operationalIssues.length ? (
                <div className="mt-5 space-y-3">
                  {metrics.operationalIssues.slice(0, 5).map((issue) => (
                    <div key={issue.id} className="border border-slate-200 p-3.5">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center ${issue.severity === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{issue.severity === "error" ? <AlertCircle className="size-4" /> : <FileWarning className="size-4" />}</span>
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-800">{issue.title}</p><span className="bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{issue.status}</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{issue.detail}</p><p className="mt-1 text-[11px] text-slate-600">{formatTime(issue.occurredAt)}</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="Systems are healthy" detail="No open processing or import issues." />}
            </article>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-2">
            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Privacy-minimized activity" detail="Operational events only. No invoice values or raw customer records." />
              {visibleActivity.length ? (
                <ol className="mt-5 space-y-1">
                  {visibleActivity.slice(0, 8).map((item, index) => (
                    <li key={item.id} className="relative flex gap-3 pb-4">
                      {index < Math.min(visibleActivity.length, 8) - 1 ? <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-slate-200" /> : null}
                      <span className={`relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center ring-1 ring-inset ${severityStyles[item.severity]}`}><Activity className="size-3.5" /></span>
                      <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{item.detail}</p><p className="mt-0.5 text-xs text-slate-600">{item.actor} · {item.organization}</p><p className="mt-1 text-[11px] text-slate-600">{formatTime(item.occurredAt)}</p></div>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState title="No activity in this period" detail="Choose a wider date range to see earlier events." />}
            </article>

            <article className="border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <SectionHeading title="Customer feedback" detail="Recent product signals for the operations team." action={<span className="inline-flex items-center gap-1.5 bg-[#e8f3ed] px-2.5 py-1.5 text-xs font-semibold text-[#176b4d]"><MessageSquareText className="size-3.5" /> {metrics.feedback.length} notes</span>} />
              {metrics.feedback.length ? (
                <div className="mt-5 space-y-3">
                  {metrics.feedback.slice(0, 5).map((feedback) => (
                    <blockquote key={feedback.id} className="border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-4"><div className="flex gap-0.5" aria-label={`${feedback.score} out of 5`}>
                        {Array.from({ length: 5 }, (_, index) => <span key={index} className={index < feedback.score ? "text-amber-400" : "text-slate-200"}>★</span>)}
                      </div><span className="bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{feedback.category}</span></div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">“{feedback.excerpt}”</p>
                      <footer className="mt-2 flex items-center justify-between text-[11px] text-slate-600"><span>{formatDate(feedback.occurredAt)}</span><span className="capitalize">{feedback.status}</span></footer>
                    </blockquote>
                  ))}
                </div>
              ) : <EmptyState title="No feedback yet" detail="New product feedback will appear here." />}
            </article>
          </section>

          <footer className="mt-8 flex flex-col gap-2 border-t border-slate-200 py-6 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p>InvoiceReconcile internal analytics · support@invoicereconcile.com</p>
            <p>Data coverage {formatDate(metrics.coverage.from)} to {formatDate(metrics.coverage.to)}</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
