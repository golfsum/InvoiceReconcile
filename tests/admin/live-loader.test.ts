import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServiceClient = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));

describe("admin metrics loader authorization", () => {
  beforeEach(() => {
    getSupabaseServiceClient.mockReset();
  });

  it("rejects callers that have not passed the admin authorization boundary", async () => {
    const { loadAdminMetrics } = await import("@/lib/admin/live");

    await expect(loadAdminMetrics({ role: "member", source: "supabase" })).rejects.toThrow(
      "authorized operator",
    );
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("uses demo metrics only for an explicit demo admin session", async () => {
    const { loadAdminMetrics } = await import("@/lib/admin/live");

    const metrics = await loadAdminMetrics({ role: "admin", source: "demo" });

    expect(metrics.dataMode).toBe("demo");
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it("reports an honest unavailable state when a real admin lacks the server read credential", async () => {
    getSupabaseServiceClient.mockReturnValue(null);
    const { loadAdminMetrics } = await import("@/lib/admin/live");

    const metrics = await loadAdminMetrics({ role: "admin", source: "supabase" });

    expect(metrics.dataMode).toBe("unavailable");
    expect(metrics.mrr.totalMrrCents).toBe(0);
    expect(metrics.availabilityMessage).toMatch(/service role/i);
  });

  it("uses the observed first paid timestamp instead of the free-row creation time", async () => {
    const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      profiles: [{ id: "user-1", email: "owner@example.com", display_name: "Owner", signup_source: "direct", created_at: "2026-01-01T00:00:00.000Z" }],
      organizations: [{ id: organizationId, name: "Example Books", status: "active", created_at: "2026-01-01T00:00:00.000Z" }],
      memberships: [{ organization_id: organizationId, user_id: "user-1", status: "active" }],
      subscriptions: [{
        id: "subscription-1",
        organization_id: organizationId,
        plan_code: "solo",
        status: "active",
        billing_interval: "month",
        unit_amount_minor: 1900,
        quantity: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        paid_started_at: "2026-08-20T15:30:00.000Z",
      }],
    };
    getSupabaseServiceClient.mockReturnValue({
      from: (table: string) => ({
        select: () => ({
          range: async () => ({ data: rowsByTable[table] || [], error: null }),
        }),
      }),
    });
    const { loadAdminMetrics } = await import("@/lib/admin/live");

    const metrics = await loadAdminMetrics({ role: "admin", source: "supabase" });

    expect(metrics.users[0]?.subscribedAt).toBe("2026-08-20T15:30:00.000Z");
    expect(metrics.users[0]?.subscribedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("excludes QA revenue, activity and mixed rollups while retaining customer usage", async () => {
    const today = new Date().toISOString();
    const rowsByTable: Record<string, Record<string, unknown>[]> = {
      profiles: [{ id: "qa" }, { id: "customer", email: "real@example.com", created_at: today }],
      organizations: [{ id: "qa-org", created_by: "qa" }, { id: "real-org", created_by: "customer" }],
      admin_reporting_exclusions: [{ kind: "user", subject_id: "qa" }],
      subscriptions: [{ id: "qa-sub", organization_id: "qa-org", plan_code: "solo", status: "active", unit_amount_minor: 1900 }],
      analytics_events: [{ user_id: "qa", event_name: "signup_completed", occurred_at: today }],
      analytics_daily_aggregates: [{ organization_id: null, metric_code: "payments_processed", metric_value: 999, aggregate_date: today }],
      usage_records: [
        { organization_id: "qa-org", metric_code: "payments_processed", quantity: 99, period_start: today },
        { organization_id: "real-org", metric_code: "payments_processed", quantity: 7, period_start: today },
      ],
    };
    getSupabaseServiceClient.mockReturnValue({ from: (table: string) => ({ select: () => ({ range: async () => ({ data: rowsByTable[table] || [], error: null }) }) }) });
    const { loadAdminMetrics } = await import("@/lib/admin/live");
    const metrics = await loadAdminMetrics({ role: "admin", source: "supabase" });
    expect(metrics.dataMode).toBe("live");
    expect(metrics.users.map((user) => user.id)).toEqual(["customer"]);
    expect(metrics.organizations.total).toBe(1);
    expect(metrics.mrr.totalMrrCents).toBe(0);
    expect(metrics.subscriptions.total).toBe(0);
    expect(metrics.activity).toHaveLength(0);
    expect(metrics.reconciliation.processed).toBe(7);
  });
});
