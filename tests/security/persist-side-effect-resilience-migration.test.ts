import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260823002200_persist_side_effect_resilience.sql"),
  "utf8",
);

describe("persist side-effect resilience migration", () => {
  it("realigns an existing reservation instead of aborting the retry", () => {
    expect(migration).toContain("set payment_count = p_payment_count");
    expect(migration).not.toContain("The reserved payment count does not match this run");
    expect(migration).toContain("to_char(v_period_start, 'YYYY-MM-DD')");
  });

  it("keeps analytics and operational metrics from rolling back a saved run", () => {
    expect(migration).toContain("exception");
    expect(migration).toContain("insert into public.analytics_events");
    expect(migration).toContain("when others then null");
  });
});
