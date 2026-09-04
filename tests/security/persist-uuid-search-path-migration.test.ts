import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260823002300_persist_uuid_search_path.sql"),
  "utf8",
);

describe("persist uuid search path migration", () => {
  it("lets persist find gen_random_uuid without opening public search_path", () => {
    expect(migration).toContain("persist_reconciliation_run_v2");
    expect(migration).toContain("set search_path = pg_catalog, extensions");
    expect(migration).not.toMatch(/set search_path = [^;]*\bpublic\b/);
  });
});
