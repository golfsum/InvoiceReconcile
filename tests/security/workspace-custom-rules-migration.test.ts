import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608230021_workspace_custom_matching_rules.sql",
  "utf8",
);

describe("workspace custom matching rules migration", () => {
  it("keeps writes route-only and tenant editor scoped", () => {
    expect(migration).toMatch(/revoke insert, update, delete on public\.matching_rules from authenticated/i);
    expect(migration.match(/app_private\.can_edit_workspace\(p_workspace_id\)/g)).toHaveLength(3);
    expect(migration).toMatch(/workspace_custom_rules_enabled\(p_workspace_id\)/i);
    expect(migration).toMatch(/plan_code in \('business', 'bookkeeper'\)/i);
    expect(migration).toMatch(/join public\.organizations o on o\.id = w\.organization_id[\s\S]*o\.status = 'active'/i);
    expect(migration).toMatch(/custom-rule-cap/i);
    expect(migration).toMatch(/grant execute on function public\.create_workspace_custom_matching_rule[\s\S]*to authenticated/i);
  });

  it("allows bounded templates but no user regex action", () => {
    expect(migration).toMatch(/custom_reference_template_is_valid/i);
    expect(migration).toMatch(/\{DIGITS\}/);
    expect(migration).toMatch(/\{ALNUM\}/);
    expect(migration).not.toMatch(/match_type\s*=\s*'regex'/i);
    expect(migration).toMatch(/maximumFeeBasisPoints[\s\S]*between 1 and 500/i);
    expect(migration).toMatch(/v_token_occurrences[\s\S]*<> 1/i);
    expect(migration).toMatch(/custom_rule_source_is_ascii\(p_source_pattern\)/i);
    expect(migration).toMatch(/custom_rule_integer_in_range\(configuration -> 'maximumFeeMinor', 1, 25000\)/i);
    expect(migration).not.toMatch(/configuration ->> 'maximumFee(?:Minor|BasisPoints)'\)::integer/i);
  });

  it("audits previous and current state for every custom mutation", () => {
    expect(migration.match(/'matching_rule\.(created|updated|deleted)'/g)).toHaveLength(3);
    expect(migration.match(/'previous_state'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/'current_state'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toMatch(/review_evidence_only/i);
    expect(migration).not.toMatch(/raw_values|raw_source|storage_path|signed_url/i);
  });
});
