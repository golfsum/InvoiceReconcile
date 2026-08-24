import { describe, expect, it } from "vitest";
import {
  aggregateAcquisitionSources,
  aggregateFunnel,
  aggregateMrr,
  aggregateRetention,
  minimizeActivityHistory,
} from "../../src/lib/admin/aggregations";
import type {
  AdminOrganizationRecord,
  AdminSubscriptionRecord,
  AdminUserRecord,
  TrafficDailyRecord,
} from "../../src/lib/admin/types";

describe("aggregateMrr", () => {
  it("normalizes annual subscriptions and excludes trialing or canceled plans", () => {
    const subscriptions: AdminSubscriptionRecord[] = [
      {
        id: "monthly",
        organizationId: "org-1",
        plan: "business",
        status: "active",
        billingInterval: "month",
        recurringAmountCents: 14_900,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "annual",
        organizationId: "org-2",
        plan: "solo",
        status: "active",
        billingInterval: "year",
        recurringAmountCents: 58_800,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "past-due",
        organizationId: "org-3",
        plan: "bookkeeper",
        status: "past_due",
        billingInterval: "month",
        recurringAmountCents: 34_900,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "trial",
        organizationId: "org-4",
        plan: "solo",
        status: "trialing",
        billingInterval: "month",
        recurringAmountCents: 4_900,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "free",
        organizationId: "org-free",
        plan: "free",
        status: "active",
        billingInterval: "month",
        recurringAmountCents: 0,
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = aggregateMrr(subscriptions);

    expect(result.totalMrrCents).toBe(54_700);
    expect(result.payingSubscriptions).toBe(3);
    expect(result.byPlan.find((item) => item.plan === "solo")).toMatchObject({
      mrrCents: 4_900,
      subscriptions: 1,
    });
    expect(
      result.byPlan.reduce((total, item) => total + item.share, 0),
    ).toBeCloseTo(1);
  });

});

describe("aggregateFunnel", () => {
  it("calculates stage and overall conversion without division errors", () => {
    const traffic: TrafficDailyRecord[] = [
      { date: "2026-01-01", visitors: 100, sessions: 130, signupStarts: 40 },
    ];
    const users = [
      user("one", "2026-01-01T10:00:00.000Z", "2026-01-01T11:00:00.000Z", "2026-01-02T10:00:00.000Z"),
      user("two", "2026-01-01T12:00:00.000Z", "2026-01-02T12:00:00.000Z"),
      user("three", "2026-01-01T13:00:00.000Z"),
      user("four", "2026-01-01T14:00:00.000Z"),
    ];

    const result = aggregateFunnel(traffic, users);

    expect(result.map((stage) => stage.count)).toEqual([100, 40, 4, 2, 1]);
    expect(result[2].fromPreviousRate).toBeCloseTo(0.1);
    expect(result[4].overallRate).toBeCloseTo(0.01);
    expect(aggregateFunnel([], [])[0].overallRate).toBe(0);
  });
});

describe("aggregateAcquisitionSources", () => {
  it("uses only observed visitor attribution and never prorates traffic from signup share", () => {
    const users = [
      user("organic-one", "2026-01-01T10:00:00.000Z"),
      user("organic-two", "2026-01-01T11:00:00.000Z"),
      { ...user("email-one", "2026-01-01T12:00:00.000Z"), source: "Email" },
    ];
    users[0].source = "Organic search";
    users[1].source = "Organic search";

    const result = aggregateAcquisitionSources(
      [
        { source: "Organic search", visitors: 25 },
        { source: "Direct / unknown", visitors: 40 },
      ],
      users,
    );

    expect(result.find((item) => item.source === "Organic search")).toMatchObject({
      visitors: 25,
      signups: 2,
      visitorToSignupRate: 0.08,
    });
    expect(result.find((item) => item.source === "Direct / unknown")).toMatchObject({
      visitors: 40,
      signups: 0,
    });
    expect(result.find((item) => item.source === "Email")).toMatchObject({
      visitors: null,
      signups: 1,
      visitorToSignupRate: null,
    });
  });
});

describe("aggregateRetention", () => {
  it("groups Monday-based cohorts and counts a user once per active week", () => {
    const users = [
      {
        signedUpAt: "2026-01-06T12:00:00.000Z",
        activityDates: [
          "2026-01-06T12:00:00.000Z",
          "2026-01-08T12:00:00.000Z",
          "2026-01-13T12:00:00.000Z",
        ],
      },
      {
        signedUpAt: "2026-01-08T12:00:00.000Z",
        activityDates: ["2026-01-08T12:00:00.000Z"],
      },
      {
        signedUpAt: "2026-01-15T12:00:00.000Z",
        activityDates: ["2026-01-16T12:00:00.000Z"],
      },
    ];

    const result = aggregateRetention(users, 3);

    expect(result).toHaveLength(2);
    expect(result[0].cohortStart).toBe("2026-01-05T00:00:00.000Z");
    expect(result[0].cohortSize).toBe(2);
    expect(result[0].retainedByWeek).toEqual([2, 1, 0]);
    expect(result[0].retentionRateByWeek).toEqual([1, 0.5, 0]);
  });
});

describe("minimizeActivityHistory", () => {
  it("uses masked actor references and only organization display names", () => {
    const organizations: AdminOrganizationRecord[] = [
      {
        id: "org-private",
        name: "Northline Parts",
        createdAt: "2026-01-01T00:00:00.000Z",
        memberCount: 2,
        connectedSystems: 1,
        status: "active",
      },
    ];

    const [activity] = minimizeActivityHistory(
      [
        {
          id: "activity-1",
          occurredAt: "2026-01-02T00:00:00.000Z",
          actorId: "usr-secret-8421",
          organizationId: "org-private",
          event: "import_completed",
          detail: "Imported 20 records",
          severity: "success",
        },
      ],
      organizations,
    );

    expect(activity.actor).toBe("User 8421");
    expect(activity.organization).toBe("Northline Parts");
    expect(activity).not.toHaveProperty("actorId");
    expect(activity).not.toHaveProperty("organizationId");
  });
});

function user(
  id: string,
  signedUpAt: string,
  activatedAt?: string,
  subscribedAt?: string,
): AdminUserRecord {
  return {
    id,
    displayName: id,
    maskedEmail: `${id[0]}***@example.test`,
    organizationId: `org-${id}`,
    plan: "solo",
    subscriptionStatus: subscribedAt ? "active" : "trialing",
    source: "Direct",
    signedUpAt,
    activatedAt,
    subscribedAt,
    activityDates: [signedUpAt],
  };
}
