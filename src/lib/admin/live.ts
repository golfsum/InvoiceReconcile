import "server-only";

import { buildAdminMetrics } from "@/lib/admin/aggregations";
import { adminDemoMetrics } from "@/lib/admin/demo-data";
import { filterAdminReportingRows } from "@/lib/admin/reporting-scope";
import type {
  AcquisitionTrafficRecord,
  ActivitySeverity,
  AdminActivityRecord,
  AdminMetrics,
  AdminOrganizationRecord,
  AdminSourceData,
  AdminSubscriptionRecord,
  AdminUserRecord,
  FeedbackRecord,
  ContactRequestRecord,
  ImportIssueRecord,
  PlanKey,
  ReconciliationDailyRecord,
  SubscriptionStatus,
  TrafficDailyRecord,
} from "@/lib/admin/types";
import type { AppUser } from "@/lib/auth/access";
import { siteConfig } from "@/lib/config";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerError } from "@/lib/logger";

type Row = Record<string, unknown>;

const stringValue = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const numberValue = (value: unknown) => typeof value === "number" ? value : Number(value || 0);
const dateValue = (value: unknown, fallback = new Date().toISOString()) => stringValue(value, fallback);
const siteHostname = new URL(siteConfig.url).hostname.toLowerCase();

function maskEmail(email: string) {
  const [local = "user", domain = "unknown"] = email.toLowerCase().split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function normalizePlan(value: unknown): PlanKey {
  return ["free", "solo", "business", "bookkeeper"].includes(String(value)) ? value as PlanKey : "free";
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (value === "trialing" || value === "past_due" || value === "canceled") return value;
  return value === "active" ? "active" : "canceled";
}

function eventSeverity(eventName: string): ActivitySeverity {
  if (eventName.includes("failed") || eventName.includes("error")) return "error";
  if (eventName.includes("warning")) return "warning";
  if (eventName.includes("completed") || eventName.includes("connected") || eventName.includes("subscription")) return "success";
  return "info";
}

function adminEvent(eventName: string): AdminActivityRecord["event"] | null {
  if (eventName === "sign_up" || eventName === "signup_completed") return "signup";
  if (eventName === "activation_completed" || eventName === "first_reconciliation_completed") return "activation";
  if (eventName.includes("subscription")) return "subscription";
  if (eventName.includes("integration") && eventName.includes("connected")) return "integration_connected";
  if (eventName.includes("import") && eventName.includes("completed")) return "import_completed";
  if (eventName.includes("reconciliation") && eventName.includes("completed")) return "reconciliation_completed";
  if (eventName.includes("failed") || eventName.includes("error")) return "job_failed";
  if (eventName.includes("feedback")) return "feedback_submitted";
  return null;
}

function activityDetail(eventName: string) {
  return eventName.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function metricRows(rows: Row[], codes: string[]) {
  return rows.filter((row) => row.organization_id === null && codes.includes(stringValue(row.metric_code)));
}

function acquisitionSource(value: unknown) {
  const source = stringValue(value).trim();
  if (!source || source === "unattributed") return "Unattributed";
  if (source === "direct") return "Direct / unknown";
  if (source === "referral") return "Referral";
  return source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unavailableMetrics(message: string) {
  const now = new Date().toISOString();
  return buildAdminMetrics({
    dataMode: "unavailable",
    availabilityMessage: message,
    users: [],
    organizations: [],
    subscriptions: [],
    traffic: [],
    acquisitionTraffic: [],
    reconciliations: [],
    importIssues: [],
    activity: [],
    feedback: [],
  }, now);
}

export async function loadAdminMetrics(operator: Pick<AppUser, "role" | "source">): Promise<AdminMetrics> {
  if (operator.role !== "admin") throw new Error("Admin metrics require an authorized operator");
  if (operator.source === "demo") return adminDemoMetrics;

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return unavailableMetrics("Live metrics require the Supabase service role on the server.");
  }

  async function fetchAll(table: string, columns = "*") {
    const collected: Row[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase!.from(table).select(columns).range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data || []) as unknown as Row[];
      collected.push(...rows);
      if (rows.length < pageSize) break;
    }
    return collected;
  }

  try {
    const requests = [
      ["profiles", "id,email,display_name,is_internal_admin,signup_source,last_seen_at,created_at"],
      ["organizations", "id,name,status,created_by,created_at"],
      ["memberships", "organization_id,user_id,status"],
      ["integrations", "organization_id,status"],
      ["subscriptions", "id,organization_id,plan_code,status,billing_interval,unit_amount_minor,quantity,paid_started_at,created_at,canceled_at"],
      ["analytics_daily_aggregates", "aggregate_date,organization_id,metric_code,metric_value,unique_users"],
      ["analytics_events", "event_id,event_name,occurred_at,anonymous_id,session_id,user_id,organization_id,utm_source,referrer_host"],
      ["usage_records", "id,organization_id,metric_code,period_start,quantity,recorded_at"],
      ["background_jobs", "id,organization_id,status,job_type,error_summary,created_at"],
      ["application_errors", "id,user_id,organization_id,error_code,severity,component,safe_message,resolved_at,created_at"],
      ["feedback", "id,user_id,organization_id,feedback_type,rating,message,status,created_at"],
      ["contact_requests", "id,email,subject,message,status,delivery_status,created_at"],
      ["admin_reporting_exclusions", "kind,subject_id"],
    ] as const;
    const raw = Object.fromEntries(await Promise.all(requests.map(async ([table, columns]) => [table, await fetchAll(table, columns)])));
    const {
      profiles, organizations: organizationsRaw, memberships, integrations, subscriptions: subscriptionsRaw,
      analytics_daily_aggregates: aggregates, analytics_events: events, usage_records: usage,
      background_jobs: jobs, application_errors: errors, feedback: feedbackRaw, contact_requests: contactRequestsRaw,
    } = filterAdminReportingRows(raw, raw.admin_reporting_exclusions, process.env.ADMIN_EMAILS);

    const membershipByUser = new Map<string, string>();
    const memberCount = new Map<string, number>();
    for (const row of memberships) {
      if (row.status !== "active") continue;
      const organizationId = stringValue(row.organization_id);
      const userId = stringValue(row.user_id);
      if (userId && !membershipByUser.has(userId)) membershipByUser.set(userId, organizationId);
      if (organizationId) memberCount.set(organizationId, (memberCount.get(organizationId) || 0) + 1);
    }

    const connectedSystems = new Map<string, number>();
    for (const row of integrations) {
      if (row.status !== "connected") continue;
      const organizationId = stringValue(row.organization_id);
      connectedSystems.set(organizationId, (connectedSystems.get(organizationId) || 0) + 1);
    }

    const subscriptionByOrganization = new Map(subscriptionsRaw.map((row) => [stringValue(row.organization_id), row]));
    const eventsByUser = new Map<string, Row[]>();
    for (const event of events) {
      const userId = stringValue(event.user_id);
      if (userId) eventsByUser.set(userId, [...(eventsByUser.get(userId) || []), event]);
    }

    const subscriptions: AdminSubscriptionRecord[] = subscriptionsRaw.map((row) => ({
      id: stringValue(row.id),
      organizationId: stringValue(row.organization_id),
      plan: normalizePlan(row.plan_code),
      status: normalizeSubscriptionStatus(row.status),
      billingInterval: row.billing_interval === "year" ? "year" : "month",
      recurringAmountCents: numberValue(row.unit_amount_minor) * Math.max(1, numberValue(row.quantity)),
      startedAt: dateValue(row.created_at),
      canceledAt: row.canceled_at ? dateValue(row.canceled_at) : undefined,
    }));

    const users: AdminUserRecord[] = profiles.map((row) => {
      const id = stringValue(row.id);
      const organizationId = membershipByUser.get(id) || "unassigned";
      const subscription = subscriptionByOrganization.get(organizationId);
      const userEvents = (eventsByUser.get(id) || []).sort((a, b) => dateValue(a.occurred_at).localeCompare(dateValue(b.occurred_at)));
      const activation = userEvents.find((event) => ["activation_completed", "first_reconciliation_completed", "reconciliation_completed", "import_completed"].includes(stringValue(event.event_name)));
      const email = stringValue(row.email, "unknown@unknown");
      return {
        id,
        displayName: stringValue(row.display_name, email.split("@")[0] || "User"),
        maskedEmail: maskEmail(email),
        organizationId,
        plan: normalizePlan(subscription?.plan_code),
        subscriptionStatus: subscription ? normalizeSubscriptionStatus(subscription.status) : "active",
        source: acquisitionSource(row.signup_source),
        signedUpAt: dateValue(row.created_at),
        activatedAt: activation ? dateValue(activation.occurred_at) : undefined,
        subscribedAt: subscription && normalizePlan(subscription.plan_code) !== "free" && subscription.paid_started_at
          ? dateValue(subscription.paid_started_at)
          : undefined,
        lastActiveAt: row.last_seen_at ? dateValue(row.last_seen_at) : undefined,
        activityDates: userEvents.map((event) => dateValue(event.occurred_at)),
      };
    });

    const organizations: AdminOrganizationRecord[] = organizationsRaw.map((row) => {
      const id = stringValue(row.id);
      const subscription = subscriptionByOrganization.get(id);
      return {
        id,
        name: stringValue(row.name, "Unnamed organization"),
        createdAt: dateValue(row.created_at),
        memberCount: memberCount.get(id) || 0,
        connectedSystems: connectedSystems.get(id) || 0,
        status: row.status !== "active" ? "paused" : subscription?.status === "trialing" ? "trial" : "active",
      };
    });

    const daily = new Map<string, { visitors: number; sessions: number; signupStarts: number; importsCompleted: number; processed: number; autoMatched: number; sentToReview: number; rejected: number; failedJobs: number }>();
    const ensureDay = (date: string) => {
      const key = date.slice(0, 10);
      const existing = daily.get(key) || { visitors: 0, sessions: 0, signupStarts: 0, importsCompleted: 0, processed: 0, autoMatched: 0, sentToReview: 0, rejected: 0, failedJobs: 0 };
      daily.set(key, existing);
      return existing;
    };

    const visitorRows = metricRows(aggregates, ["visitors", "unique_visitors"]);
    for (const row of aggregates.filter((row) => row.organization_id === null)) {
      const target = ensureDay(dateValue(row.aggregate_date));
      const value = numberValue(row.metric_value);
      const code = stringValue(row.metric_code);
      if (code === "visitors" || code === "unique_visitors") target.visitors += numberValue(row.unique_users) || value;
      if (code === "sessions") target.sessions += value;
      if (code === "signup_started" || code === "signup_starts") target.signupStarts += value;
      if (code === "imports_completed") target.importsCompleted += value;
      if (code === "payments_processed" || code === "records_processed") target.processed += value;
      if (code === "auto_matched") target.autoMatched += value;
      if (code === "sent_to_review") target.sentToReview += value;
      if (code === "rejected") target.rejected += value;
      if (code === "failed_jobs") target.failedJobs += value;
    }

    if (visitorRows.length === 0) {
      const visitorsByDay = new Map<string, Set<string>>();
      const sessionsByDay = new Map<string, Set<string>>();
      for (const event of events) {
        const day = dateValue(event.occurred_at).slice(0, 10);
        const target = ensureDay(day);
        const name = stringValue(event.event_name);
        const visitorId = stringValue(event.anonymous_id) || stringValue(event.user_id);
        const sessionId = stringValue(event.session_id);
        if (["page_view", "site_visit", "pricing_viewed"].includes(name)) {
          if (visitorId) (visitorsByDay.get(day) || visitorsByDay.set(day, new Set()).get(day)!).add(visitorId);
          if (sessionId) (sessionsByDay.get(day) || sessionsByDay.set(day, new Set()).get(day)!).add(sessionId);
        }
        if (name === "signup_started") target.signupStarts += 1;
      }
      for (const [day, ids] of visitorsByDay) ensureDay(day).visitors = ids.size;
      for (const [day, ids] of sessionsByDay) ensureDay(day).sessions = ids.size;
    }

    const aggregateMetricCodes = new Set(aggregates.filter((row) => row.organization_id === null).map((row) => stringValue(row.metric_code)));
    for (const row of usage) {
      const target = ensureDay(dateValue(row.period_start));
      const code = stringValue(row.metric_code);
      if (code === "imports_completed" && !aggregateMetricCodes.has(code)) target.importsCompleted += numberValue(row.quantity);
      if (code === "payments_processed" && !aggregateMetricCodes.has(code) && !aggregateMetricCodes.has("records_processed")) target.processed += numberValue(row.quantity);
      if (code === "auto_matched" && !aggregateMetricCodes.has(code)) target.autoMatched += numberValue(row.quantity);
      if (code === "sent_to_review" && !aggregateMetricCodes.has(code)) target.sentToReview += numberValue(row.quantity);
      if (code === "matches_rejected" && !aggregateMetricCodes.has("rejected")) target.rejected += numberValue(row.quantity);
    }
    for (const row of jobs) {
      if (row.status === "failed" || row.status === "dead_letter") ensureDay(dateValue(row.created_at)).failedJobs += 1;
    }
    for (const row of errors) {
      if ((row.severity === "error" || row.severity === "critical") && !row.resolved_at) ensureDay(dateValue(row.created_at)).failedJobs += 1;
    }

    const traffic: TrafficDailyRecord[] = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, visitors: value.visitors, sessions: value.sessions, signupStarts: value.signupStarts }));
    const reconciliations: ReconciliationDailyRecord[] = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, importsCompleted: value.importsCompleted, processed: value.processed, autoMatched: value.autoMatched, sentToReview: value.sentToReview, rejected: value.rejected, failedJobs: value.failedJobs }));

    const visitorSources = new Map<string, string>();
    for (const event of [...events].sort((a, b) => dateValue(a.occurred_at).localeCompare(dateValue(b.occurred_at)))) {
      if (!["page_view", "site_visit", "pricing_viewed"].includes(stringValue(event.event_name))) continue;
      const visitorId = stringValue(event.anonymous_id);
      if (!visitorId || visitorSources.has(visitorId)) continue;
      const referrerHostname = stringValue(event.referrer_host).toLowerCase();
      const source = event.utm_source
        ? acquisitionSource(event.utm_source)
        : referrerHostname && referrerHostname !== siteHostname
          ? "Referral"
          : "Direct / unknown";
      visitorSources.set(visitorId, source);
    }
    const acquisitionCounts = new Map<string, number>();
    for (const source of visitorSources.values()) {
      acquisitionCounts.set(source, (acquisitionCounts.get(source) ?? 0) + 1);
    }
    const acquisitionTraffic: AcquisitionTrafficRecord[] = [...acquisitionCounts].map(([source, visitors]) => ({ source, visitors }));

    const importIssues: ImportIssueRecord[] = errors.filter((row) => stringValue(row.component).includes("import")).map((row) => ({
      id: stringValue(row.id),
      occurredAt: dateValue(row.created_at),
      source: stringValue(row.component, "Import"),
      category: stringValue(row.error_code).includes("date") ? "invalid_date" : stringValue(row.error_code).includes("column") ? "missing_column" : stringValue(row.error_code).includes("duplicate") ? "duplicate" : "format",
      affectedRows: 1,
      status: row.resolved_at ? "resolved" : "open",
    }));

    const activity: AdminActivityRecord[] = events.flatMap((row) => {
      const name = stringValue(row.event_name);
      const event = adminEvent(name);
      return event ? [{ id: stringValue(row.event_id), occurredAt: dateValue(row.occurred_at), actorId: stringValue(row.user_id) || undefined, organizationId: stringValue(row.organization_id) || undefined, event, detail: activityDetail(name), severity: eventSeverity(name) }] : [];
    });
    activity.push(...jobs.filter((row) => row.status === "failed" || row.status === "dead_letter").map((row) => ({ id: stringValue(row.id), occurredAt: dateValue(row.created_at), organizationId: stringValue(row.organization_id) || undefined, event: "job_failed" as const, detail: stringValue(row.error_summary, `${activityDetail(stringValue(row.job_type))} failed`), severity: "error" as const })));

    const feedback: FeedbackRecord[] = feedbackRaw.map((row) => ({
      id: stringValue(row.id),
      occurredAt: dateValue(row.created_at),
      score: Math.min(5, Math.max(1, numberValue(row.rating) || 3)) as 1 | 2 | 3 | 4 | 5,
      category: row.feedback_type === "matching_quality" ? "matching" : row.feedback_type === "import_problem" ? "imports" : "product",
      excerpt: stringValue(row.message).slice(0, 240),
      status: row.status === "new" ? "new" : row.status === "reviewing" ? "reviewed" : "planned",
    }));

    const contactRequests: ContactRequestRecord[] = contactRequestsRaw.map((row) => ({
      id: stringValue(row.id),
      occurredAt: dateValue(row.created_at),
      maskedEmail: maskEmail(stringValue(row.email, "unknown@unknown")),
      subject: stringValue(row.subject, "Support request").slice(0, 160),
      excerpt: stringValue(row.message).slice(0, 240),
      status: ["reviewing", "resolved", "spam"].includes(stringValue(row.status))
        ? stringValue(row.status) as ContactRequestRecord["status"]
        : "new",
      deliveryStatus: ["delivered", "failed", "demo"].includes(stringValue(row.delivery_status))
        ? stringValue(row.delivery_status) as ContactRequestRecord["deliveryStatus"]
        : "pending",
    }));

    const source: AdminSourceData = { dataMode: "live", users, organizations, subscriptions, traffic, acquisitionTraffic, reconciliations, importIssues, activity, feedback, contactRequests };
    return buildAdminMetrics(source);
  } catch (error) {
    logServerError(error, { operation: "admin_analytics_query" });
    return unavailableMetrics("Live metrics could not be loaded. Check the server logs and Supabase connection.");
  }
}
