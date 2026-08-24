import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230007_route_only_public_writes.sql"),
  "utf8",
);

const financialTables = [
  "customers",
  "payer_aliases",
  "payment_sources",
  "imports",
  "import_rows",
  "invoices",
  "payments",
  "matches",
  "match_invoice_links",
  "match_payment_links",
  "match_explanations",
  "matching_rules",
  "reconciliation_actions",
  "audit_events",
  "integrations",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("route-only financial writes", () => {
  it("revokes browser DML while retaining the existing read grants", () => {
    expect(migration).toContain("revoke insert, update, delete on");
    for (const table of financialTables.filter((table) => !["reconciliation_actions", "audit_events"].includes(table))) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("revoke insert, update, delete on public.reconciliation_actions, public.audit_events from authenticated");
    expect(migration).toContain("revoke usage on sequence public.audit_events_id_seq from authenticated");
    expect(migration).not.toContain("revoke select on public.customers");
  });

  it("removes column grants that survive table-level revocation", () => {
    expect(migration).toContain(") on public.reconciliation_actions from authenticated");
    expect(migration).toContain(") on public.audit_events from authenticated");
    expect(migration).toContain(") on public.feedback from authenticated");
  });

  it("has no application source path that directly mutates a core financial table", () => {
    const sources = sourceFiles(resolve(process.cwd(), "src"));
    const violations: string[] = [];
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      for (const table of financialTables) {
        const directMutation = new RegExp(
          String.raw`\.from\(\s*["']${table}["']\s*\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(`,
          "g",
        );
        if (directMutation.test(source)) violations.push(`${path}:${table}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
