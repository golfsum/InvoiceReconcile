import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230012_workspace_lifecycle.sql"),
  "utf8",
);

describe("workspace lifecycle migration guardrails", () => {
  it("removes direct table mutations that would bypass audited RPCs", () => {
    expect(migration).toContain("revoke insert, delete on public.workspaces from authenticated");
    expect(migration).toContain("revoke update (");
    expect(migration).toContain("revoke delete on public.organizations from authenticated");
  });

  it("serializes capacity changes and blocks every uncanceled paid subscription", () => {
    expect(migration.match(/workspace-capacity/g)).toHaveLength(2);
    expect(migration).toContain("v_subscription.status <> 'canceled'");
  });

  it("validates named timezones in both create and update functions", () => {
    expect(migration.match(/pg_catalog\.pg_timezone_names/g)).toHaveLength(2);
  });

  it("provides a lightweight, permission-scoped portfolio metric function", () => {
    expect(migration).toContain("function public.get_workspace_portfolio_metrics()");
    expect(migration).toContain("app_private.is_org_member(w.organization_id)");
    expect(migration).toContain("payments_workspace_import_idx");
  });
});
