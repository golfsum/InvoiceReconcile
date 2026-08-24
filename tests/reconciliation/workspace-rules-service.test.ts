import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logServerError: vi.fn() }));

const customers = [
  { id: "customer-a", name: "Acme Consulting LLC", externalId: "ACME-001" },
];

const rows = [
  {
    id: "rule-description",
    rule_type: "description_pattern",
    source_pattern: "Parent remittance",
    normalized_pattern: "PARENT REMITTANCE",
    customer_id: "customer-a",
    action_type: "map_customer",
    configuration: { matchMode: "contains_normalized" },
    created_at: "2026-08-23T12:00:00.000Z",
  },
  {
    id: "rule-reference",
    rule_type: "reference_pattern",
    source_pattern: "NS-2026-{digits}",
    normalized_pattern: "NS-2026-{DIGITS}",
    customer_id: null,
    action_type: "extract_reference",
    configuration: { templateVersion: 1 },
    created_at: "2026-08-23T12:01:00.000Z",
  },
  {
    id: "rule-fee",
    rule_type: "fee_behavior",
    source_pattern: "Card settlement",
    normalized_pattern: "CARD SETTLEMENT",
    customer_id: null,
    action_type: "flag_possible_fee",
    configuration: { maximumFeeMinor: 500, maximumFeeBasisPoints: 300 },
    created_at: "2026-08-23T12:02:00.000Z",
  },
];

function catalogClient(organizationStatus: "active" | "suspended") {
  const dataByTable: Record<string, unknown> = {
    payer_aliases: [],
    customers: [{ id: "customer-a", name: "Acme Consulting LLC", external_id: "ACME-001", status: "active" }],
    matching_rules: rows,
    subscriptions: { plan_code: "business", status: "active" },
    organizations: { status: organizationStatus },
  };
  return {
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => ({ data: dataByTable[table], error: null })),
        maybeSingle: vi.fn(async () => ({ data: dataByTable[table], error: null })),
      };
      return builder;
    }),
  };
}

describe("workspace custom rule catalog", () => {
  it("parses every safe rule shape and fingerprints behavior deterministically", async () => {
    const { buildWorkspaceCustomRules, customMatchingRuleFingerprint } = await import("@/lib/reconciliation/workspace-rules");
    const rules = buildWorkspaceCustomRules(rows, customers);
    expect(rules).toHaveLength(3);
    expect(rules?.map((rule) => rule.kind)).toEqual(["accepted_fee_behavior", "description_customer", "reference_template"]);
    expect(customMatchingRuleFingerprint(rules!)).toBe(customMatchingRuleFingerprint([...rules!].reverse()));
    expect(customMatchingRuleFingerprint(rules!)).toMatch(/^[a-f0-9]{64}$/);
    expect(customMatchingRuleFingerprint(rules!.map((rule) => rule.kind === "accepted_fee_behavior" ? { ...rule, maximumFeeMinor: 501 } : rule)))
      .not.toBe(customMatchingRuleFingerprint(rules!));
  });

  it("fails closed on a raw regex or configuration keys outside the contract", async () => {
    const { buildWorkspaceCustomRules } = await import("@/lib/reconciliation/workspace-rules");
    expect(buildWorkspaceCustomRules([{ ...rows[1], source_pattern: "NS-[0-9]+", normalized_pattern: "NS-[0-9]+" }], customers)).toBeNull();
    expect(buildWorkspaceCustomRules([{ ...rows[1], source_pattern: "Café-{digits}", normalized_pattern: "CAF-{DIGITS}" }], customers)).toBeNull();
    expect(buildWorkspaceCustomRules([{ ...rows[2], configuration: { ...rows[2].configuration, autoApply: true } }], customers)).toBeNull();
  });

  it("applies custom rules only while the owning organization is active", async () => {
    const { loadWorkspaceMatchingRuleCatalog } = await import("@/lib/reconciliation/workspace-rules");
    const active = await loadWorkspaceMatchingRuleCatalog(
      catalogClient("active") as never,
      "workspace-a",
      "organization-a",
    );
    expect(active).toMatchObject({
      status: "ready",
      catalog: { customRulesEnabled: true, plan: "business" },
    });

    const suspended = await loadWorkspaceMatchingRuleCatalog(
      catalogClient("suspended") as never,
      "workspace-a",
      "organization-a",
    );
    expect(suspended).toEqual({ status: "unavailable" });
  });

  it("withholds custom rules from the engine when the plan is not eligible", async () => {
    const { workspaceRuleRuntime } = await import("@/lib/reconciliation/workspace-rules");
    const parsed = (await import("@/lib/reconciliation/workspace-rules")).buildWorkspaceCustomRules(rows, customers)!;
    const runtime = workspaceRuleRuntime({
      payerMappings: [],
      customRules: parsed,
      customers,
      plan: "solo",
      customRulesEnabled: false,
      payerMappingFingerprint: "0".repeat(64),
    });
    expect(runtime.context.customRules).toEqual([]);
    expect(runtime.matchingRuleFingerprint).toBeUndefined();
  });
});
