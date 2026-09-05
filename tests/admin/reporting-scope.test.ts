import { describe, expect, it } from "vitest";
import { filterAdminReportingRows } from "@/lib/admin/reporting-scope";

const exclusions = [{ kind: "user", subject_id: "qa" }, { kind: "contact_request", subject_id: "test-contact" }];

describe("customer-only admin reporting", () => {
  it("filters internal accounts, owned organizations and all scoped activity without mutating source records", () => {
    const tables = {
      profiles: [{ id: "qa" }, { id: "customer" }],
      organizations: [{ id: "qa-org", created_by: "qa" }, { id: "real-org", created_by: "customer" }],
      memberships: [{ user_id: "qa", organization_id: "qa-org", status: "active" }],
      ...Object.fromEntries(["subscriptions", "usage_records", "integrations", "background_jobs", "application_errors", "feedback"].map((table) => [table, [
        { organization_id: "qa-org" }, { organization_id: "real-org" }, { user_id: "qa" },
      ]])),
      contact_requests: [{ id: "test-contact" }, { id: "customer-contact" }],
    };
    const before = structuredClone(tables);
    const result = filterAdminReportingRows(tables, exclusions);
    expect(result.profiles).toEqual([{ id: "customer" }]);
    expect(result.organizations).toEqual([{ id: "real-org", created_by: "customer" }]);
    for (const table of ["subscriptions", "usage_records", "integrations", "background_jobs", "application_errors", "feedback"]) {
      expect(result[table]).toEqual([{ organization_id: "real-org" }]);
    }
    expect(result.contact_requests).toEqual([{ id: "customer-contact" }]);
    expect(tables).toEqual(before);
  });

  it("recognizes admin flags and the normalized environment allowlist without changing roles", () => {
    const result = filterAdminReportingRows({ profiles: [
      { id: "flagged", is_internal_admin: true }, { id: "owner", email: "Owner@Example.com" }, { id: "customer" },
    ] }, [], " owner@example.com, ");
    expect(result.profiles).toEqual([{ id: "customer" }]);
  });

  it("preserves organizations with real active members, even when created by an admin", () => {
    const result = filterAdminReportingRows({
      organizations: [{ id: "shared", created_by: "qa" }],
      memberships: [{ organization_id: "shared", user_id: "customer", status: "active" }],
      subscriptions: [{ organization_id: "shared" }],
    }, exclusions);
    expect(result.organizations).toHaveLength(1);
    expect(result.subscriptions).toHaveLength(1);
  });

  it("removes linked pre-login QA traffic but preserves unlinked visits and identified customers", () => {
    const result = filterAdminReportingRows({ analytics_events: [
      { id: "qa-login", user_id: "qa", anonymous_id: "qa-browser", session_id: "qa-session" },
      { id: "qa-prelogin", anonymous_id: "qa-browser" },
      { id: "qa-session", session_id: "qa-session" },
      { id: "unknown", anonymous_id: "unknown" },
      { id: "customer", user_id: "customer", anonymous_id: "shared" },
      { id: "qa-shared", user_id: "qa", anonymous_id: "shared" },
      { id: "unknown-shared", anonymous_id: "shared" },
    ] }, exclusions);
    expect(result.analytics_events.map((row) => row.id)).toEqual(["unknown", "customer", "unknown-shared"]);
  });

  it("drops mixed global rollups when exclusions require rebuilding from raw customer data", () => {
    const tables = { analytics_daily_aggregates: [{ organization_id: null }, { organization_id: "customer-org" }] };
    expect(filterAdminReportingRows(tables, exclusions).analytics_daily_aggregates).toEqual([{ organization_id: "customer-org" }]);
    expect(filterAdminReportingRows(tables, []).analytics_daily_aggregates).toHaveLength(2);
  });

  it("supports reversing an exclusion without deleting any records", () => {
    const tables = { profiles: [{ id: "qa" }] };
    expect(filterAdminReportingRows(tables, exclusions).profiles).toHaveLength(0);
    expect(filterAdminReportingRows(tables, []).profiles).toHaveLength(1);
  });
});
