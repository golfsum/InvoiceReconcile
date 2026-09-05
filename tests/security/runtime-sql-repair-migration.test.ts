import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260904000100_repair_runtime_sql.sql"), "utf8");

describe("runtime SQL repairs", () => {
  it("counts JSON object keys with PostgreSQL-supported functions", () => {
    expect(migration).toContain("(select count(*) from jsonb_object_keys(v_invoice_map))");
  });

  it("qualifies the outer invoice ID in the lateral balance query", () => {
    expect(migration).toContain("item(value)");
    expect(migration).toContain("entry.key = (item.value ->> ''id'')");
  });

  it("repairs all four composite selections without replacing authorization", () => {
    for (const name of ["update_workspace_custom_matching_rule", "delete_workspace_custom_matching_rule", "update_workspace_payer_mapping", "delete_workspace_payer_mapping"]) {
      expect(migration).toContain(name);
    }
    expect(migration).toContain("pg_get_functiondef");
    expect(migration).not.toMatch(/disable row level security|grant .* to anon/i);
    expect(migration).toContain("raise exception");
  });
});
