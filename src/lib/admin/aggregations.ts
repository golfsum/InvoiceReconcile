import type {
  AcquisitionTrafficRecord,
  AcquisitionSourceMetric,
  ActivationMetric,
  AdminActivityRecord,
  AdminMetrics,
  AdminOrganizationRecord,
  AdminSourceData,
  AdminSubscriptionRecord,
  AdminUserRecord,
  DailyAdminMetric,
  DateRange,
  FunnelStage,
  IsoDate,
  MrrSummary,
  OperationalIssue,
  OrganizationMetric,
  PlanKey,
  PrivacySafeActivity,
  ReconciliationDailyRecord,
  ReconciliationMetric,
  RetentionCohort,
  SubscriptionMetric,
  TrafficDailyRecord,
} from "./types";

const DAY_MS = 86_400_000;
const PLAN_ORDER: PlanKey[] = ["free", "solo", "business", "bookkeeper"];

const toMillis = (value: IsoDate) => new Date(value).getTime();

const dateKey = (value: IsoDate) => value.slice(0, 10);

const safeRate = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

const startOfUtcWeek = (value: IsoDate) => {
  const date = new Date(value);
  const day = date.getUTCDay();
  const distanceFromMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - distanceFromMonday);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

export function withinRange(value: IsoDate, range: DateRange) {
  const time = toMillis(value);
  return time >= toMillis(range.from) && time <= toMillis(range.to);
}

export function aggregateMrr(
  subscriptions: AdminSubscriptionRecord[],
): MrrSummary {
  const included = subscriptions.filter(
    (subscription) =>
      subscription.plan !== "free"
      && subscription.recurringAmountCents > 0
      && (subscription.status === "active" || subscription.status === "past_due"),
  );
  const centsFor = (subscription: AdminSubscriptionRecord) =>
    subscription.billingInterval === "year"
      ? Math.round(subscription.recurringAmountCents / 12)
      : subscription.recurringAmountCents;

  const totalMrrCents = included.reduce(
    (sum, subscription) => sum + centsFor(subscription),
    0,
  );

  return {
    totalMrrCents,
    payingSubscriptions: included.length,
    byPlan: PLAN_ORDER.map((plan) => {
      const planSubscriptions = included.filter(
        (subscription) => subscription.plan === plan,
      );
      const mrrCents = planSubscriptions.reduce(
        (sum, subscription) => sum + centsFor(subscription),
        0,
      );
      return {
        plan,
        mrrCents,
        subscriptions: planSubscriptions.length,
        share: safeRate(mrrCents, totalMrrCents),
      };
    }),
  };
}

export function aggregateFunnel(
  traffic: TrafficDailyRecord[],
  users: AdminUserRecord[],
): FunnelStage[] {
  const counts = [
    traffic.reduce((sum, point) => sum + point.visitors, 0),
    traffic.reduce((sum, point) => sum + point.signupStarts, 0),
    users.length,
    users.filter((user) => Boolean(user.activatedAt)).length,
    users.filter((user) => Boolean(user.subscribedAt)).length,
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
    fromPreviousRate: index === 0 ? 1 : safeRate(counts[index], counts[index - 1]),
    overallRate: safeRate(counts[index], counts[0]),
  }));
}

export function aggregateRetention(
  users: Pick<AdminUserRecord, "signedUpAt" | "activityDates">[],
  weekCount = 4,
): RetentionCohort[] {
  const cohorts = new Map<string, typeof users>();

  for (const user of users) {
    const cohortStart = startOfUtcWeek(user.signedUpAt).toISOString();
    cohorts.set(cohortStart, [...(cohorts.get(cohortStart) ?? []), user]);
  }

  return [...cohorts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohortStart, cohortUsers]) => {
      const start = toMillis(cohortStart);
      const retainedByWeek = Array.from({ length: weekCount }, (_, weekIndex) =>
        cohortUsers.filter((user) =>
          user.activityDates.some((activityDate) => {
            const activityTime = toMillis(activityDate);
            const weekStart = start + weekIndex * 7 * DAY_MS;
            return activityTime >= weekStart && activityTime < weekStart + 7 * DAY_MS;
          }),
        ).length,
      );
      return {
        cohortStart,
        cohortSize: cohortUsers.length,
        retainedByWeek,
        retentionRateByWeek: retainedByWeek.map((count) =>
          safeRate(count, cohortUsers.length),
        ),
      };
    });
}

export function aggregateOrganizations(
  organizations: AdminOrganizationRecord[],
): OrganizationMetric {
  return {
    total: organizations.length,
    active: organizations.filter((organization) => organization.status === "active")
      .length,
    trials: organizations.filter((organization) => organization.status === "trial")
      .length,
    paused: organizations.filter((organization) => organization.status === "paused")
      .length,
    averageMembers:
      organizations.length > 0
        ? organizations.reduce(
            (sum, organization) => sum + organization.memberCount,
            0,
          ) / organizations.length
        : 0,
    connectedSystems: organizations.reduce(
      (sum, organization) => sum + organization.connectedSystems,
      0,
    ),
  };
}

export function aggregateSubscriptions(
  subscriptions: AdminSubscriptionRecord[],
): SubscriptionMetric {
  return {
    total: subscriptions.length,
    active: subscriptions.filter((item) => item.status === "active").length,
    trialing: subscriptions.filter((item) => item.status === "trialing").length,
    pastDue: subscriptions.filter((item) => item.status === "past_due").length,
    canceled: subscriptions.filter((item) => item.status === "canceled").length,
  };
}

export function aggregateActivation(users: AdminUserRecord[]): ActivationMetric {
  const activated = users.filter((user) => Boolean(user.activatedAt));
  const times = activated
    .map((user) =>
      Math.round((toMillis(user.activatedAt!) - toMillis(user.signedUpAt)) / 60_000),
    )
    .filter((minutes) => minutes >= 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const medianTimeToValueMinutes =
    times.length === 0
      ? null
      : times.length % 2 === 0
        ? Math.round((times[middle - 1] + times[middle]) / 2)
        : times[middle];

  return {
    eligibleUsers: users.length,
    activatedUsers: activated.length,
    activationRate: safeRate(activated.length, users.length),
    medianTimeToValueMinutes,
  };
}

export function aggregateReconciliation(
  points: ReconciliationDailyRecord[],
): ReconciliationMetric {
  const importsCompleted = points.reduce((sum, point) => sum + (point.importsCompleted ?? 0), 0);
  const processed = points.reduce((sum, point) => sum + point.processed, 0);
  const autoMatched = points.reduce((sum, point) => sum + point.autoMatched, 0);
  const sentToReview = points.reduce(
    (sum, point) => sum + point.sentToReview,
    0,
  );
  const rejected = points.reduce((sum, point) => sum + point.rejected, 0);
  return {
    importsCompleted,
    processed,
    autoMatched,
    sentToReview,
    rejected,
    autoMatchRate: safeRate(autoMatched, processed),
    reviewRate: safeRate(sentToReview, processed),
    rejectionRate: safeRate(rejected, processed),
  };
}

export function aggregateAcquisitionSources(
  acquisitionTraffic: AcquisitionTrafficRecord[],
  users: AdminUserRecord[],
): AcquisitionSourceMetric[] {
  const visitorCounts = new Map<string, number>();
  const signupCounts = new Map<string, number>();
  const activatedCounts = new Map<string, number>();
  const subscribedCounts = new Map<string, number>();
  for (const observation of acquisitionTraffic) {
    visitorCounts.set(
      observation.source,
      (visitorCounts.get(observation.source) ?? 0) + observation.visitors,
    );
  }
  for (const user of users) {
    signupCounts.set(user.source, (signupCounts.get(user.source) ?? 0) + 1);
    if (user.activatedAt) {
      activatedCounts.set(user.source, (activatedCounts.get(user.source) ?? 0) + 1);
    }
    if (user.subscribedAt) {
      subscribedCounts.set(user.source, (subscribedCounts.get(user.source) ?? 0) + 1);
    }
  }
  const sources = new Set([...visitorCounts.keys(), ...signupCounts.keys()]);

  return [...sources]
    .map((source) => {
      const signups = signupCounts.get(source) ?? 0;
      const visitors = visitorCounts.get(source) ?? null;
      const activated = activatedCounts.get(source) ?? 0;
      const subscribed = subscribedCounts.get(source) ?? 0;
      return {
        source,
        visitors,
        signups,
        activated,
        subscribed,
        visitorToSignupRate:
          visitors !== null && visitors > 0 ? safeRate(signups, visitors) : null,
        signupToPaidRate: safeRate(subscribed, signups),
      };
    })
    .sort((a, b) => (b.visitors ?? 0) - (a.visitors ?? 0) || b.signups - a.signups);
}

export function minimizeActivityHistory(
  records: AdminActivityRecord[],
  organizations: AdminOrganizationRecord[],
): PrivacySafeActivity[] {
  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );
  return records
    .map((record) => ({
      id: record.id,
      occurredAt: record.occurredAt,
      actor: record.actorLabel ?? (record.actorId ? `User ${record.actorId.slice(-4)}` : "System"),
      organization: record.organizationId
        ? (organizationNames.get(record.organizationId) ?? "Unknown organization")
        : "Platform",
      event: record.event,
      detail: record.detail,
      severity: record.severity,
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function aggregateOperationalIssues(
  source: AdminSourceData,
): OperationalIssue[] {
  const failedJobs: OperationalIssue[] = source.activity
    .filter((record) => record.event === "job_failed")
    .map((record) => ({
      id: record.id,
      occurredAt: record.occurredAt,
      title: "Processing job failed",
      detail: record.detail,
      severity: "error" as const,
      status: "open" as const,
    }));
  const imports: OperationalIssue[] = source.importIssues
    .filter((issue) => issue.status !== "resolved")
    .map((issue) => ({
      id: issue.id,
      occurredAt: issue.occurredAt,
      title: `${issue.source} import issue`,
      detail: `${issue.affectedRows} rows need attention: ${issue.category.replaceAll("_", " ")}`,
      severity: "warning" as const,
      status: issue.status,
    }));
  return [...failedJobs, ...imports].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );
}

export function buildDailyMetrics(source: AdminSourceData): DailyAdminMetric[] {
  const dates = new Set([
    ...source.traffic.map((item) => dateKey(item.date)),
    ...source.reconciliations.map((item) => dateKey(item.date)),
    ...source.users.map((user) => dateKey(user.signedUpAt)),
  ]);
  const sortedDates = [...dates].sort();
  return sortedDates.map((date) => {
    const traffic = source.traffic.find((item) => dateKey(item.date) === date);
    const reconciliation = source.reconciliations.find(
      (item) => dateKey(item.date) === date,
    );
    const users = source.users.filter((user) => dateKey(user.signedUpAt) === date);
    return {
      date,
      visitors: traffic?.visitors ?? 0,
      sessions: traffic?.sessions ?? 0,
      signupStarts: traffic?.signupStarts ?? 0,
      signups: users.length,
      activations: source.users.filter(
        (user) => user.activatedAt && dateKey(user.activatedAt) === date,
      ).length,
      subscriptions: source.users.filter(
        (user) => user.subscribedAt && dateKey(user.subscribedAt) === date,
      ).length,
      importsCompleted: reconciliation?.importsCompleted ?? 0,
      processed: reconciliation?.processed ?? 0,
      autoMatched: reconciliation?.autoMatched ?? 0,
      sentToReview: reconciliation?.sentToReview ?? 0,
      rejected: reconciliation?.rejected ?? 0,
      failedJobs: reconciliation?.failedJobs ?? 0,
    };
  });
}

export function buildAdminMetrics(
  source: AdminSourceData,
  generatedAt = new Date().toISOString(),
): AdminMetrics {
  const daily = buildDailyMetrics(source);
  const coverage = {
    from: daily[0]?.date ?? generatedAt,
    to: daily.at(-1)?.date ?? generatedAt,
  };
  const usersByRecent = [...source.users].sort((a, b) =>
    b.signedUpAt.localeCompare(a.signedUpAt),
  );
  return {
    generatedAt,
    dataMode: source.dataMode,
    availabilityMessage: source.availabilityMessage,
    coverage,
    users: usersByRecent,
    organizations: aggregateOrganizations(source.organizations),
    subscriptions: aggregateSubscriptions(source.subscriptions),
    mrr: aggregateMrr(source.subscriptions),
    daily,
    funnel: aggregateFunnel(source.traffic, source.users),
    acquisition: aggregateAcquisitionSources(source.acquisitionTraffic, source.users),
    activation: aggregateActivation(source.users),
    retention: aggregateRetention(source.users),
    reconciliation: aggregateReconciliation(source.reconciliations),
    failedJobs: source.reconciliations.reduce(
      (sum, point) => sum + point.failedJobs,
      0,
    ),
    operationalIssues: aggregateOperationalIssues(source),
    importIssues: [...source.importIssues].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    ),
    feedback: [...source.feedback].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    ),
    contactRequests: [...(source.contactRequests ?? [])].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt),
    ),
    recentSignups: usersByRecent.slice(0, 12),
    activity: minimizeActivityHistory(source.activity, source.organizations),
  };
}
