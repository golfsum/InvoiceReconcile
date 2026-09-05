import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { plans } from "@/lib/config";

const sql = readFileSync("supabase/migrations/20260905000100_free_payment_allowance.sql", "utf8");

describe("monthly payment policy", () => {
  it("keeps database and published plan limits in agreement", () => {
    for (const plan of plans) {
      expect(sql).toContain(plan.key === "free" ? `else ${plan.paymentLimit}` : `when '${plan.key}' then ${plan.paymentLimit}`);
    }
    expect(plans.map((plan) => plan.paymentLimit)).toEqual([20, 500, 2500, 10000]);
  });

  it.each([
    "reserve_reconciliation_capacity",
    "enqueue_async_reconciliation",
    "worker_claim_async_reconciliation",
    "worker_complete_async_reconciliation",
  ])("uses the private policy in %s without dropping security checks", (name) => {
    const body = sql.split(`create or replace function public.${name}(`)[1]?.split("\n$$;")[0];
    expect(body).toContain("app_private.monthly_payment_limit(v_plan_code)");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain(name.startsWith("worker_") ? "app_private.require_service_role()" : "auth.role() <> 'authenticated'");
    expect(body).not.toMatch(/else 50\b|:= 50;/);
  });

  it("keeps the policy private and retains monthly concurrency guards", () => {
    expect(sql).toContain("from public, anon, authenticated, service_role;");
    expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(sql).toContain("'code', 'already_processed'");
    expect(sql).not.toMatch(/drop table|truncate|delete from public\.(usage_records|subscriptions|reconciliation_runs)/i);
  });
});
