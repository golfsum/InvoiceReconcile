import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const loadWorkspaceMatchingRuleCatalog = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/reconciliation/workspace-rules", () => ({
  loadWorkspaceMatchingRuleCatalog,
  workspaceRuleRuntime: (catalog: { payerMappings: unknown[]; customRules: unknown[]; customRulesEnabled: boolean; payerMappingFingerprint: string; matchingRuleFingerprint?: string }) => ({
    context: { payerMappings: catalog.payerMappings, customRules: catalog.customRulesEnabled ? catalog.customRules : [] },
    payerMappingFingerprint: catalog.payerMappingFingerprint,
    matchingRuleFingerprint: catalog.matchingRuleFingerprint,
  }),
}));

const workspaceId = "11000000-0000-4000-8000-000000000001";
const mappingFingerprint = "a".repeat(64);
const customRuleFingerprint = "b".repeat(64);

afterEach(async () => {
  getSupabaseServerClient.mockReset();
  loadWorkspaceMatchingRuleCatalog.mockReset();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("reconciliation route payer rule consumption", () => {
  it("persists the active rule fingerprint and transparent mapping evidence", async () => {
    loadWorkspaceMatchingRuleCatalog.mockResolvedValue({
      status: "ready",
      catalog: {
        payerMappingFingerprint: mappingFingerprint,
        customers: [],
        customRules: [{
          id: "11800000-0000-4000-8000-000000000002",
          kind: "description_customer",
          sourcePattern: "Parent remittance",
          normalizedPattern: "PARENT REMITTANCE",
          customerId: "11100000-0000-4000-8000-000000000001",
          customerName: "Acme Consulting LLC",
        }],
        customRulesEnabled: true,
        plan: "business",
        matchingRuleFingerprint: customRuleFingerprint,
        payerMappings: [{
          id: "11800000-0000-4000-8000-000000000001",
          alias: "ZXQ TREASURY",
          normalizedAlias: "ZXQ TREASURY",
          customerId: "11100000-0000-4000-8000-000000000001",
          customerName: "Acme Consulting LLC",
          createdAt: "2026-08-23T12:00:00.000Z",
        }],
      },
    });
    let savedSnapshot: Record<string, unknown> | null = null;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_reconciliation_import_context") {
        return { data: { invoice_states: [], payment_states: [] }, error: null };
      }
      if (name === "reserve_reconciliation_capacity") {
        return { data: { allowed: true, code: "allowed", plan: "solo", limit: 500, used: 0, requested: 1, remaining: 499, period_start: "2026-08-01", period_end: "2026-08-31", existing: false, reservation_id: "11900000-0000-4000-8000-000000000001" }, error: null };
      }
      if (name === "persist_reconciliation_run_v2") {
        savedSnapshot = args.p_snapshot as Record<string, unknown>;
        return { data: { run_record_id: "11700000-0000-4000-8000-000000000001", saved_at: "2026-08-23T12:00:00.000Z" }, error: null };
      }
      return { data: null, error: { code: "unknown_rpc" } };
    });
    const maybeSingle = vi.fn(async () => ({ data: {
      id: workspaceId,
      organization_id: "12000000-0000-4000-8000-000000000001",
      currency_code: "USD",
      match_days_before: 3,
      match_days_after: 90,
    }, error: null }));
    getSupabaseServerClient.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
      from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
      rpc,
    });

    const entries = new Map<string, FormDataEntryValue>();
    entries.set("workspaceId", workspaceId);
    entries.set("invoiceFile", new NodeFile([
      "Invoice Number,Customer Name,Invoice Date,Original Amount,Outstanding Balance,Currency\nINV-A,Acme Consulting LLC,2026-07-01,100.00,100.00,USD\nINV-B,Beta Supply LLC,2026-07-01,100.00,100.00,USD\n",
    ], "invoices.csv", { type: "text/csv" }) as unknown as File);
    entries.set("paymentFile", new NodeFile([
      "Payment Date,Amount,Payer Name,Description,Transaction ID,Currency\n2026-07-02,100.00,ZXQ TREASURY,PARENT REMITTANCE,TX-1,USD\n",
    ], "payments.csv", { type: "text/csv" }) as unknown as File);

    const { POST } = await import("@/app/api/reconciliation/run/route");
    const response = await POST({
      url: `https://invoicereconcile.com/api/reconciliation/run?workspaceId=${workspaceId}`,
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => ({ get: (key: string) => entries.get(key) ?? null }),
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(savedSnapshot).not.toBeNull();
    expect(savedSnapshot).toMatchObject({ reconciliationContext: {
      payerMappingFingerprint: mappingFingerprint,
      matchingRuleFingerprint: customRuleFingerprint,
    } });
    const snapshot = savedSnapshot as unknown as { invoices: Array<{ id: string; customerName: string }>; result: { matches: Array<{ confidence: string; invoiceIds: string[]; evidence: Array<{ code: string }> }> } };
    const acmeInvoice = snapshot.invoices.find((invoice) => invoice.customerName === "Acme Consulting LLC");
    expect(snapshot.result.matches[0]).toMatchObject({
      confidence: "high_confidence",
      invoiceIds: [acmeInvoice?.id],
      evidence: expect.arrayContaining([
        expect.objectContaining({ code: "payer_mapping_exact" }),
        expect.objectContaining({ code: "description_mapping_exact" }),
      ]),
    });
  });
});
