import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const aliases = [{
  id: "rule-1",
  alias: "ACH ORIG: PARENT TREASURY",
  normalized_alias: "ACH ORIG PARENT TREASURY",
  customer_id: "customer-1",
  match_type: "exact_normalized",
  created_at: "2026-08-23T12:00:00.000Z",
}];

const customers = [{
  id: "customer-1",
  name: "Acme Consulting LLC",
  external_id: "ACME-001",
  status: "active",
}];

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

describe("workspace payer rule service", () => {
  it("joins active aliases to workspace customers and fingerprints behavior stably", async () => {
    const { buildWorkspacePayerRuleCatalog, payerMappingFingerprint } = await import("@/lib/reconciliation/payer-rules");
    const catalog = buildWorkspacePayerRuleCatalog(aliases, customers);
    expect(catalog).toMatchObject({
      rules: [{
        id: "rule-1",
        customerId: "customer-1",
        customerName: "Acme Consulting LLC",
        customerExternalId: "ACME-001",
      }],
      customers: [{ id: "customer-1", name: "Acme Consulting LLC", externalId: "ACME-001" }],
    });
    expect(catalog?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payerMappingFingerprint([catalog!.rules[0]])).toBe(payerMappingFingerprint([{ ...catalog!.rules[0] }]));
    expect(payerMappingFingerprint([{ ...catalog!.rules[0], customerName: "Different Customer" }])).not.toBe(catalog?.fingerprint);
  });

  it("fails closed when live rule storage cannot be read", async () => {
    const aliasQuery = query({ data: null, error: { code: "PGRST500" } });
    const customerQuery = query({ data: customers, error: null });
    const from = vi.fn((table: string) => table === "payer_aliases" ? aliasQuery : customerQuery);
    const { loadWorkspacePayerRuleCatalog } = await import("@/lib/reconciliation/payer-rules");
    const result = await loadWorkspacePayerRuleCatalog({ from } as never, "11000000-0000-4000-8000-000000000001");
    expect(result).toEqual({ status: "unavailable" });
  });
});
