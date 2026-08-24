import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230014_initial_workspace_matching_window.sql"),
  "utf8",
);

describe("initial workspace matching defaults migration", () => {
  it("replaces the old RPC signature and exposes only the authenticated six-argument function", () => {
    expect(migration).toContain("drop function if exists public.create_initial_workspace(text, text, text, text, text)");
    expect(migration).toContain("p_match_days_after smallint default 90");
    expect(migration).toContain("revoke all on function public.create_initial_workspace(text, text, text, text, text, smallint) from public, anon");
    expect(migration).toContain("grant execute on function public.create_initial_workspace(text, text, text, text, text, smallint) to authenticated");
  });

  it("validates timezone and date window before creating tenant records", () => {
    expect(migration).toContain("pg_catalog.pg_timezone_names");
    expect(migration).toContain("p_match_days_after not between 1 and 365");
    expect(migration).toContain("timezone, match_days_after, created_by");
    expect(migration).toContain("p_match_days_after, actor_id");
    expect(migration).toContain("set match_days_after = greatest(1, least(365, match_days_after))");
    expect(migration).toContain("match_days_before between 0 and 365 and match_days_after between 1 and 365");
  });
});
