import { buildAdminMetrics } from "./aggregations";
import type {
  AcquisitionTrafficRecord,
  AdminActivityRecord,
  AdminOrganizationRecord,
  AdminSourceData,
  AdminSubscriptionRecord,
  AdminUserRecord,
  FeedbackRecord,
  ImportIssueRecord,
  ReconciliationDailyRecord,
  TrafficDailyRecord,
} from "./types";

const DEMO_NOW = new Date("2026-08-22T18:30:00.000Z");
const DAY_MS = 86_400_000;

const isoDaysAgo = (days: number, hour = 15) => {
  const date = new Date(DEMO_NOW.getTime() - days * DAY_MS);
  date.setUTCHours(hour, (days * 7) % 60, 0, 0);
  return date.toISOString();
};

const organizations: AdminOrganizationRecord[] = [
  { id: "org-01", name: "Northline Parts", createdAt: isoDaysAgo(79), memberCount: 5, connectedSystems: 3, status: "active" },
  { id: "org-02", name: "Summit Field Services", createdAt: isoDaysAgo(68), memberCount: 3, connectedSystems: 2, status: "active" },
  { id: "org-03", name: "Harbor & Pine Supply", createdAt: isoDaysAgo(57), memberCount: 8, connectedSystems: 4, status: "active" },
  { id: "org-04", name: "Mesa Packaging Co.", createdAt: isoDaysAgo(44), memberCount: 4, connectedSystems: 2, status: "active" },
  { id: "org-05", name: "Keystone Mechanical", createdAt: isoDaysAgo(31), memberCount: 2, connectedSystems: 1, status: "trial" },
  { id: "org-06", name: "Juniper Office Group", createdAt: isoDaysAgo(22), memberCount: 6, connectedSystems: 3, status: "active" },
  { id: "org-07", name: "Stonebridge Foods", createdAt: isoDaysAgo(11), memberCount: 2, connectedSystems: 1, status: "trial" },
  { id: "org-08", name: "Cedar Peak Dental", createdAt: isoDaysAgo(7), memberCount: 1, connectedSystems: 0, status: "paused" },
  { id: "org-09", name: "Bluebird Property Care", createdAt: isoDaysAgo(3), memberCount: 3, connectedSystems: 1, status: "trial" },
];

const userBlueprints = [
  ["usr-1001", "Avery Morgan", "av***@northline.example", "org-01", "business", "active", "Organic search", 79, 78, 74, 1],
  ["usr-1002", "Jordan Lee", "jo***@summit.example", "org-02", "solo", "active", "Referral", 68, 67, 61, 2],
  ["usr-1003", "Mina Patel", "mi***@harborpine.example", "org-03", "bookkeeper", "active", "Partner", 57, 55, 51, 1],
  ["usr-1004", "Theo Wright", "th***@mesapack.example", "org-04", "business", "active", "Organic search", 44, 43, 37, 1],
  ["usr-1005", "Camille Reed", "ca***@keystone.example", "org-05", "solo", "trialing", "Product Hunt", 31, 29, null, 2],
  ["usr-1006", "Noah Bennett", "no***@juniperoffice.example", "org-06", "business", "active", "Referral", 22, 21, 15, 1],
  ["usr-1007", "Riley Torres", "ri***@stonebridge.example", "org-07", "solo", "trialing", "Organic search", 11, 10, null, 1],
  ["usr-1008", "Samira Brooks", "sa***@cedarpeak.example", "org-08", "solo", "canceled", "Direct", 7, null, null, 7],
  ["usr-1009", "Elliot Chen", "el***@bluebird.example", "org-09", "business", "trialing", "LinkedIn", 3, 2, null, 1],
  ["usr-1010", "Priya Shah", "pr***@northline.example", "org-01", "business", "active", "Invite", 25, 24, 20, 1],
  ["usr-1011", "Marcus Hale", "ma***@harborpine.example", "org-03", "bookkeeper", "active", "Invite", 18, 16, 13, 1],
  ["usr-1012", "Elena Ruiz", "el***@juniperoffice.example", "org-06", "business", "past_due", "Invite", 14, 13, 9, 1],
  ["usr-1013", "Will Carter", "wi***@stonebridge.example", "org-07", "solo", "trialing", "LinkedIn", 5, 4, null, 1],
  ["usr-1014", "Dani Kim", "da***@bluebird.example", "org-09", "business", "trialing", "Referral", 1, 0, null, 1],
] as const;

const users: AdminUserRecord[] = userBlueprints.map(
  ([id, displayName, maskedEmail, organizationId, plan, subscriptionStatus, source, signedUpDays, activatedDays, subscribedDays, lastActiveDays]) => {
    const signedUpAt = isoDaysAgo(signedUpDays, 14);
    const activityDates = Array.from({ length: Math.min(12, signedUpDays + 1) }, (_, index) =>
      isoDaysAgo(Math.max(0, signedUpDays - index * 5), 16),
    );
    return {
      id,
      displayName,
      maskedEmail,
      organizationId,
      plan,
      subscriptionStatus,
      source,
      signedUpAt,
      activatedAt: activatedDays === null ? undefined : isoDaysAgo(activatedDays, 17),
      subscribedAt: subscribedDays === null ? undefined : isoDaysAgo(subscribedDays, 12),
      lastActiveAt: isoDaysAgo(lastActiveDays, 18),
      activityDates,
    };
  },
);

const subscriptions: AdminSubscriptionRecord[] = [
  { id: "sub-01", organizationId: "org-01", plan: "business", status: "active", billingInterval: "month", recurringAmountCents: 4900, startedAt: isoDaysAgo(74) },
  { id: "sub-02", organizationId: "org-02", plan: "solo", status: "active", billingInterval: "year", recurringAmountCents: 22800, startedAt: isoDaysAgo(61) },
  { id: "sub-03", organizationId: "org-03", plan: "bookkeeper", status: "active", billingInterval: "month", recurringAmountCents: 9900, startedAt: isoDaysAgo(51) },
  { id: "sub-04", organizationId: "org-04", plan: "business", status: "active", billingInterval: "year", recurringAmountCents: 58800, startedAt: isoDaysAgo(37) },
  { id: "sub-05", organizationId: "org-05", plan: "solo", status: "trialing", billingInterval: "month", recurringAmountCents: 1900, startedAt: isoDaysAgo(31) },
  { id: "sub-06", organizationId: "org-06", plan: "business", status: "past_due", billingInterval: "month", recurringAmountCents: 4900, startedAt: isoDaysAgo(15) },
  { id: "sub-07", organizationId: "org-08", plan: "solo", status: "canceled", billingInterval: "month", recurringAmountCents: 1900, startedAt: isoDaysAgo(7), canceledAt: isoDaysAgo(2) },
];

const traffic: TrafficDailyRecord[] = Array.from({ length: 90 }, (_, reverseIndex) => {
  const daysAgo = 89 - reverseIndex;
  const weeklyWave = [3, 7, 11, 6, 15, -5, -9][reverseIndex % 7];
  const visitors = 72 + Math.round(reverseIndex * 0.72) + weeklyWave;
  return {
    date: isoDaysAgo(daysAgo, 0).slice(0, 10),
    visitors,
    sessions: Math.round(visitors * 1.28),
    signupStarts: Math.max(2, Math.round(visitors * (0.045 + (reverseIndex % 4) * 0.004))),
  };
});

const acquisitionTraffic: AcquisitionTrafficRecord[] = [
  { source: "Organic search", visitors: 4_180 },
  { source: "Referral", visitors: 1_460 },
  { source: "LinkedIn", visitors: 920 },
  { source: "Product Hunt", visitors: 610 },
  { source: "Direct / unknown", visitors: 2_130 },
];

const reconciliations: ReconciliationDailyRecord[] = Array.from(
  { length: 90 },
  (_, reverseIndex) => {
    const daysAgo = 89 - reverseIndex;
    const processed = 190 + reverseIndex * 8 + (reverseIndex % 6) * 23;
    const rejected = Math.round(processed * (0.018 + (reverseIndex % 3) * 0.002));
    const sentToReview = Math.round(processed * (0.11 - reverseIndex * 0.00025));
    return {
      date: isoDaysAgo(daysAgo, 0).slice(0, 10),
      importsCompleted: Math.max(1, Math.round(processed / 60)),
      processed,
      autoMatched: processed - sentToReview - rejected,
      sentToReview,
      rejected,
      failedJobs: reverseIndex % 19 === 0 ? 1 : 0,
    };
  },
);

const importIssues: ImportIssueRecord[] = [
  { id: "imp-301", occurredAt: isoDaysAgo(1, 16), source: "QuickBooks CSV", category: "invalid_date", affectedRows: 14, status: "open" },
  { id: "imp-302", occurredAt: isoDaysAgo(3, 11), source: "Vendor export", category: "missing_column", affectedRows: 38, status: "monitoring" },
  { id: "imp-303", occurredAt: isoDaysAgo(8, 9), source: "NetSuite CSV", category: "duplicate", affectedRows: 7, status: "resolved" },
  { id: "imp-304", occurredAt: isoDaysAgo(13, 13), source: "Bank statement", category: "format", affectedRows: 21, status: "resolved" },
];

const activity: AdminActivityRecord[] = [
  { id: "act-01", occurredAt: isoDaysAgo(0, 18), actorId: "usr-1014", organizationId: "org-09", event: "activation", detail: "Completed the first reconciliation workflow", severity: "success" },
  { id: "act-02", occurredAt: isoDaysAgo(0, 15), actorId: "usr-1001", organizationId: "org-01", event: "import_completed", detail: "Imported 486 records from an accounting export", severity: "success" },
  { id: "act-03", occurredAt: isoDaysAgo(1, 14), actorId: "usr-1014", organizationId: "org-09", event: "signup", detail: "Created a workspace from a referral", severity: "info" },
  { id: "act-04", occurredAt: isoDaysAgo(1, 9), organizationId: "org-03", event: "job_failed", detail: "One scheduled import stopped after a column mapping changed", severity: "error" },
  { id: "act-05", occurredAt: isoDaysAgo(2, 17), actorId: "usr-1009", organizationId: "org-09", event: "integration_connected", detail: "Connected the first accounting source", severity: "success" },
  { id: "act-06", occurredAt: isoDaysAgo(3, 12), actorId: "usr-1007", organizationId: "org-07", event: "reconciliation_completed", detail: "Reviewed and approved the first exception queue", severity: "success" },
  { id: "act-07", occurredAt: isoDaysAgo(4, 16), actorLabel: "Support operator", organizationId: "org-06", event: "feedback_submitted", detail: "Logged product feedback from a support conversation", severity: "info" },
  { id: "act-08", occurredAt: isoDaysAgo(5, 10), organizationId: "org-02", event: "job_failed", detail: "A vendor export exceeded the configured file size limit", severity: "warning" },
  { id: "act-09", occurredAt: isoDaysAgo(7, 13), actorId: "usr-1008", organizationId: "org-08", event: "signup", detail: "Created a workspace from direct traffic", severity: "info" },
];

const feedback: FeedbackRecord[] = [
  { id: "fb-01", occurredAt: isoDaysAgo(1, 13), score: 5, category: "matching", excerpt: "The exception explanations made month-end review much faster.", status: "reviewed" },
  { id: "fb-02", occurredAt: isoDaysAgo(4, 10), score: 4, category: "imports", excerpt: "Would like saved column mappings for our weekly vendor file.", status: "planned" },
  { id: "fb-03", occurredAt: isoDaysAgo(6, 15), score: 5, category: "support", excerpt: "Support found our date formatting issue in one reply.", status: "reviewed" },
  { id: "fb-04", occurredAt: isoDaysAgo(9, 11), score: 3, category: "product", excerpt: "The review queue needs a clearer way to return to the last item.", status: "new" },
];

export const adminDemoSource: AdminSourceData = {
  dataMode: "demo",
  users,
  organizations,
  subscriptions,
  traffic,
  acquisitionTraffic,
  reconciliations,
  importIssues,
  activity,
  feedback,
};

export const adminDemoMetrics = buildAdminMetrics(
  adminDemoSource,
  DEMO_NOW.toISOString(),
);
