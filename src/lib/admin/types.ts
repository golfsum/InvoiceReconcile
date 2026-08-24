export type IsoDate = string;

export type AdminDataMode = "demo" | "live" | "unavailable";
export type PlanKey = "free" | "solo" | "business" | "bookkeeper";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type ActivitySeverity = "info" | "success" | "warning" | "error";

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface AdminUserRecord {
  id: string;
  displayName: string;
  maskedEmail: string;
  organizationId: string;
  plan: PlanKey;
  subscriptionStatus: SubscriptionStatus;
  source: string;
  signedUpAt: IsoDate;
  activatedAt?: IsoDate;
  subscribedAt?: IsoDate;
  lastActiveAt?: IsoDate;
  activityDates: IsoDate[];
}

export interface AdminOrganizationRecord {
  id: string;
  name: string;
  createdAt: IsoDate;
  memberCount: number;
  connectedSystems: number;
  status: "active" | "trial" | "paused";
}

export interface AdminSubscriptionRecord {
  id: string;
  organizationId: string;
  plan: PlanKey;
  status: SubscriptionStatus;
  billingInterval: "month" | "year";
  recurringAmountCents: number;
  startedAt: IsoDate;
  canceledAt?: IsoDate;
}

export interface TrafficDailyRecord {
  date: IsoDate;
  visitors: number;
  sessions: number;
  signupStarts: number;
}

export interface AcquisitionTrafficRecord {
  source: string;
  visitors: number;
}

export interface ReconciliationDailyRecord {
  date: IsoDate;
  importsCompleted?: number;
  processed: number;
  autoMatched: number;
  sentToReview: number;
  rejected: number;
  failedJobs: number;
}

export interface ImportIssueRecord {
  id: string;
  occurredAt: IsoDate;
  source: string;
  category: "missing_column" | "invalid_date" | "duplicate" | "format";
  affectedRows: number;
  status: "open" | "monitoring" | "resolved";
}

export interface AdminActivityRecord {
  id: string;
  occurredAt: IsoDate;
  actorId?: string;
  actorLabel?: string;
  organizationId?: string;
  event:
    | "signup"
    | "activation"
    | "subscription"
    | "integration_connected"
    | "import_completed"
    | "reconciliation_completed"
    | "job_failed"
    | "feedback_submitted";
  detail: string;
  severity: ActivitySeverity;
}

export interface FeedbackRecord {
  id: string;
  occurredAt: IsoDate;
  score: 1 | 2 | 3 | 4 | 5;
  category: "product" | "matching" | "imports" | "support";
  excerpt: string;
  status: "new" | "reviewed" | "planned";
}

export interface ContactRequestRecord {
  id: string;
  occurredAt: IsoDate;
  maskedEmail: string;
  subject: string;
  excerpt: string;
  status: "new" | "reviewing" | "resolved" | "spam";
  deliveryStatus: "pending" | "delivered" | "failed" | "demo";
}

export interface AdminSourceData {
  dataMode: AdminDataMode;
  availabilityMessage?: string;
  users: AdminUserRecord[];
  organizations: AdminOrganizationRecord[];
  subscriptions: AdminSubscriptionRecord[];
  traffic: TrafficDailyRecord[];
  acquisitionTraffic: AcquisitionTrafficRecord[];
  reconciliations: ReconciliationDailyRecord[];
  importIssues: ImportIssueRecord[];
  activity: AdminActivityRecord[];
  feedback: FeedbackRecord[];
  contactRequests?: ContactRequestRecord[];
}

export interface MrrByPlan {
  plan: PlanKey;
  mrrCents: number;
  subscriptions: number;
  share: number;
}

export interface MrrSummary {
  totalMrrCents: number;
  payingSubscriptions: number;
  byPlan: MrrByPlan[];
}

export interface FunnelStage {
  key: "visitors" | "started" | "signed_up" | "activated" | "subscribed";
  label: string;
  count: number;
  fromPreviousRate: number;
  overallRate: number;
}

export interface RetentionCohort {
  cohortStart: IsoDate;
  cohortSize: number;
  retainedByWeek: number[];
  retentionRateByWeek: number[];
}

export interface AcquisitionSourceMetric {
  source: string;
  visitors: number | null;
  signups: number;
  activated: number;
  subscribed: number;
  visitorToSignupRate: number | null;
  signupToPaidRate: number;
}

export interface DailyAdminMetric {
  date: IsoDate;
  visitors: number;
  sessions: number;
  signupStarts: number;
  signups: number;
  activations: number;
  subscriptions: number;
  importsCompleted: number;
  processed: number;
  autoMatched: number;
  sentToReview: number;
  rejected: number;
  failedJobs: number;
}

export interface ActivationMetric {
  eligibleUsers: number;
  activatedUsers: number;
  activationRate: number;
  medianTimeToValueMinutes: number | null;
}

export interface ReconciliationMetric {
  importsCompleted: number;
  processed: number;
  autoMatched: number;
  sentToReview: number;
  rejected: number;
  autoMatchRate: number;
  reviewRate: number;
  rejectionRate: number;
}

export interface OrganizationMetric {
  total: number;
  active: number;
  trials: number;
  paused: number;
  averageMembers: number;
  connectedSystems: number;
}

export interface SubscriptionMetric {
  total: number;
  active: number;
  trialing: number;
  pastDue: number;
  canceled: number;
}

export interface PrivacySafeActivity {
  id: string;
  occurredAt: IsoDate;
  actor: string;
  organization: string;
  event: AdminActivityRecord["event"];
  detail: string;
  severity: ActivitySeverity;
}

export interface OperationalIssue {
  id: string;
  occurredAt: IsoDate;
  title: string;
  detail: string;
  severity: "warning" | "error";
  status: "open" | "monitoring" | "resolved";
}

export interface AdminMetrics {
  generatedAt: IsoDate;
  dataMode: AdminDataMode;
  availabilityMessage?: string;
  coverage: DateRange;
  users: AdminUserRecord[];
  organizations: OrganizationMetric;
  subscriptions: SubscriptionMetric;
  mrr: MrrSummary;
  daily: DailyAdminMetric[];
  funnel: FunnelStage[];
  acquisition: AcquisitionSourceMetric[];
  activation: ActivationMetric;
  retention: RetentionCohort[];
  reconciliation: ReconciliationMetric;
  failedJobs: number;
  operationalIssues: OperationalIssue[];
  importIssues: ImportIssueRecord[];
  feedback: FeedbackRecord[];
  contactRequests: ContactRequestRecord[];
  recentSignups: AdminUserRecord[];
  activity: PrivacySafeActivity[];
}
