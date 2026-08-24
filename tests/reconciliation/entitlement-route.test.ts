import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClient = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/reconciliation/workspace-rules", () => ({
  loadWorkspaceMatchingRuleCatalog: vi.fn(async () => ({
    status: "ready",
    catalog: { payerMappings: [], customRules: [], customers: [], plan: "free", customRulesEnabled: false, payerMappingFingerprint: "0".repeat(64) },
  })),
  workspaceRuleRuntime: vi.fn(() => ({ context: { payerMappings: [], customRules: [] }, payerMappingFingerprint: "0".repeat(64) })),
}));

function reconciliationFiles(workspaceId: string) {
  const entries = new Map<string, FormDataEntryValue>();
  entries.set("workspaceId", workspaceId);
  entries.set("invoiceFile", new NodeFile([
    "Invoice Number,Customer Name,Invoice Date,Original Amount,Outstanding Balance,Currency\nINV-1,Acme LLC,2026-07-01,100.00,100.00,USD\n",
  ], "invoices.csv", { type: "text/csv" }) as unknown as File);
  entries.set("paymentFile", new NodeFile([
    "Payment Date,Amount,Payer Name,Bank Reference,Transaction ID,Currency\n2026-07-02,100.00,Acme LLC,INV-1,TX-1,USD\n",
  ], "payments.csv", { type: "text/csv" }) as unknown as File);
  return { get: (key: string) => entries.get(key) ?? null };
}

function authorizedClient(entitlement: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_reconciliation_import_context") return {
      data: { invoice_states: [], payment_states: [] },
      error: null,
    };
    if (name === "reserve_reconciliation_capacity") return { data: entitlement, error: null };
    if (name === "persist_reconciliation_run_v2") return {
      data: { run_record_id: "d5e14a5b-861f-4e35-bff7-f59e849f5ace", saved_at: "2026-08-23T18:00:00.000Z" },
      error: null,
    };
    return { data: null, error: { code: "unknown_rpc" } };
  });
  const maybeSingle = vi.fn(async () => ({
    data: {
      id: "11000000-0000-4000-8000-000000000001",
      organization_id: "12000000-0000-4000-8000-000000000001",
      currency_code: "USD",
      match_days_before: 3,
      match_days_after: 90,
    },
    error: null,
  }));
  return {
    rpc,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })),
  };
}

afterEach(async () => {
  getSupabaseServerClient.mockReset();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("reconciliation entitlement route", () => {
  it("returns a structured upgrade response and never persists a denied run", async () => {
    const workspaceId = "11000000-0000-4000-8000-000000000001";
    const client = authorizedClient({
      allowed: false,
      code: "payment_limit_exceeded",
      plan: "free",
      limit: 50,
      used: 50,
      requested: 1,
      remaining: 0,
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      existing: false,
    });
    getSupabaseServerClient.mockResolvedValue(client);
    const { POST } = await import("@/app/api/reconciliation/run/route");
    const response = await POST({
      url: `https://invoicereconcile.com/api/reconciliation/run?workspaceId=${workspaceId}`,
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => reconciliationFiles(workspaceId),
    } as unknown as Request);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      code: "payment_limit_exceeded",
      upgradeRequired: true,
      upgradeUrl: "/settings/billing",
      entitlement: { plan: "free", limit: 50, used: 50, requested: 1, remaining: 0 },
    });
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_reconciliation_import_context",
      "reserve_reconciliation_capacity",
    ]);
  });

  it("reserves capacity before creating the durable run", async () => {
    const workspaceId = "11000000-0000-4000-8000-000000000001";
    const client = authorizedClient({
      allowed: true,
      code: "allowed",
      plan: "solo",
      limit: 500,
      used: 20,
      requested: 1,
      remaining: 479,
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      existing: false,
      reservation_id: "e005818e-784c-4fbc-8a0f-de37f4c123b7",
    });
    getSupabaseServerClient.mockResolvedValue(client);
    const { POST } = await import("@/app/api/reconciliation/run/route");
    const response = await POST({
      url: `https://invoicereconcile.com/api/reconciliation/run?workspaceId=${workspaceId}`,
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => reconciliationFiles(workspaceId),
    } as unknown as Request);

    expect(response.status).toBe(200);
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_reconciliation_import_context",
      "reserve_reconciliation_capacity",
      "persist_reconciliation_run_v2",
    ]);
  });
});
