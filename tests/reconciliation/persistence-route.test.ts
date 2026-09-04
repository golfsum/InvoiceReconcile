import { File as NodeFile } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/reconciliation/workspace-rules", () => ({
  loadWorkspaceMatchingRuleCatalog: vi.fn(async () => ({
    status: "ready",
    catalog: { payerMappings: [], customRules: [], customers: [], plan: "free", customRulesEnabled: false, payerMappingFingerprint: "0".repeat(64) },
  })),
  workspaceRuleRuntime: vi.fn(() => ({ context: { payerMappings: [], customRules: [] }, payerMappingFingerprint: "0".repeat(64) })),
}));

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase/server");
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("reconciliation persistence route", () => {
  it("returns a complete browser-local result when durable storage is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const entries = new Map<string, FormDataEntryValue>();
    entries.set("workspaceId", "demo");
    entries.set("invoiceFile", new NodeFile([
      "Invoice Number,Customer Name,Invoice Date,Original Amount,Outstanding Balance,Currency\nINV-1,Acme LLC,2026-07-01,100.00,100.00,USD\n",
    ], "invoices.csv", { type: "text/csv" }) as unknown as File);
    entries.set("paymentFile", new NodeFile([
      "Payment Date,Amount,Payer Name,Bank Reference,Transaction ID,Currency\n2026-07-02,100.00,Acme LLC,INV-1,TX-1,USD\n",
    ], "payments.csv", { type: "text/csv" }) as unknown as File);

    const { POST } = await import("@/app/api/reconciliation/run/route");
    const request = {
      url: "https://invoicereconcile.com/api/reconciliation/run",
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => ({ get: (key: string) => entries.get(key) ?? null }),
    } as unknown as Request;
    const response = await POST(request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      persistence: { status: "local", reason: "demo" },
      importSummary: { invoicesAccepted: 1, paymentsAccepted: 1 },
    });
    expect(body.runId).toMatch(/^[a-f0-9-]+$/);
    expect(body.result.matches).toHaveLength(1);
  });

  it("rejects a live workspace before parsing files when durable storage is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const formData = vi.fn();
    const { POST } = await import("@/app/api/reconciliation/run/route");
    const request = {
      url: "https://invoicereconcile.com/api/reconciliation/run?workspaceId=11000000-0000-4000-8000-000000000001",
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData,
    } as unknown as Request;
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(formData).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("No files were processed") });
  });

  it("returns a compact receipt after a live run is durably saved", async () => {
    const workspaceId = "11000000-0000-4000-8000-000000000001";
    const runRecordId = "11700000-0000-4000-8000-000000000001";
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_reconciliation_import_context") {
        return { data: { invoice_states: [], payment_states: [] }, error: null };
      }
      if (name === "reserve_reconciliation_capacity") {
        return { data: { allowed: true, code: "allowed", plan: "free", limit: 100, used: 0, requested: 1, remaining: 99, period_start: "2026-08-01", period_end: "2026-08-31", existing: false, reservation_id: "11700000-0000-4000-8000-000000000002" }, error: null };
      }
      if (name === "persist_reconciliation_run_v2") {
        return { data: { run_record_id: runRecordId, saved_at: "2026-08-23T12:00:00.000Z" }, error: null };
      }
      return { data: null, error: { code: "unknown_rpc" } };
    });
    const supabase = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } }, error: null })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: {
        id: workspaceId,
        organization_id: "12000000-0000-4000-8000-000000000001",
        currency_code: "USD",
        match_days_before: 3,
        match_days_after: 90,
      }, error: null })) })) })) })),
      rpc,
    };
    vi.doMock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => supabase) }));

    const entries = new Map<string, FormDataEntryValue>();
    entries.set("workspaceId", workspaceId);
    entries.set("invoiceFile", new NodeFile([
      "Invoice Number,Customer Name,Invoice Date,Original Amount,Outstanding Balance,Currency\nINV-1,Acme LLC,2026-07-01,100.00,100.00,USD\n",
    ], "invoices.csv", { type: "text/csv" }) as unknown as File);
    entries.set("paymentFile", new NodeFile([
      "Payment Date,Amount,Payer Name,Bank Reference,Transaction ID,Currency\n2026-07-02,100.00,Acme LLC,INV-1,TX-1,USD\n",
    ], "payments.csv", { type: "text/csv" }) as unknown as File);

    const { POST } = await import("@/app/api/reconciliation/run/route");
    const response = await POST({
      url: `https://invoicereconcile.com/api/reconciliation/run?workspaceId=${workspaceId}`,
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => ({ get: (key: string) => entries.get(key) ?? null }),
    } as unknown as Request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      persistence: { status: "durable", runRecordId },
      counts: { invoices: 1, payments: 1, matches: 1, review: 0 },
    });
    expect(body).not.toHaveProperty("invoices");
    expect(body).not.toHaveProperty("payments");
    expect(body).not.toHaveProperty("result");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "get_reconciliation_import_context",
      "reserve_reconciliation_capacity",
      "persist_reconciliation_run_v2",
    ]);
  });

  it("carries an unresolved canonical payment without billing it again and preserves duplicate source evidence", async () => {
    const workspaceId = "11000000-0000-4000-8000-000000000001";
    let savedSnapshot: Record<string, unknown> | undefined;
    let savedPaymentImport: { rows: Array<Record<string, unknown>> } | undefined;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_reconciliation_import_context") {
        const sourcePayments = args.p_payments as Array<{ id: string }>;
        return {
          data: {
            invoice_states: [],
            payment_states: [
              { client_id: sourcePayments[0].id, unapplied_amount_minor: 3_500, status: "partially_applied" },
              { client_id: sourcePayments[1].id, unapplied_amount_minor: 0, status: "reconciled" },
            ],
          },
          error: null,
        };
      }
      if (name === "reserve_reconciliation_capacity") {
        return { data: { allowed: true, code: "allowed", plan: "free", limit: 50, used: 20, requested: 0, remaining: 30, period_start: "2026-08-01", period_end: "2026-08-31", existing: false, reservation_id: "11700000-0000-4000-8000-000000000002" }, error: null };
      }
      if (name === "persist_reconciliation_run_v2") {
        savedSnapshot = args.p_snapshot as Record<string, unknown>;
        savedPaymentImport = args.p_payment_import as { rows: Array<Record<string, unknown>> };
        return { data: {
          run_record_id: "11700000-0000-4000-8000-000000000001",
          saved_at: "2026-08-23T12:00:00.000Z",
          new_payment_count: 0,
          duplicate_payment_count: 2,
          carried_payment_count: 1,
          resolved_payment_count: 1,
          duplicate_invoice_count: 0,
        }, error: null };
      }
      return { data: null, error: { code: "unknown_rpc" } };
    });
    const supabase = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } }, error: null })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: {
        id: workspaceId,
        organization_id: "12000000-0000-4000-8000-000000000001",
        currency_code: "USD",
        match_days_before: 3,
        match_days_after: 90,
      }, error: null })) })) })) })),
      rpc,
    };
    vi.doMock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => supabase) }));

    const entries = new Map<string, FormDataEntryValue>();
    entries.set("workspaceId", workspaceId);
    entries.set("invoiceFile", new NodeFile([
      "Invoice Number,Customer Name,Invoice Date,Original Amount,Outstanding Balance,Currency\nINV-1,Acme LLC,2026-07-01,35.00,35.00,USD\n",
    ], "invoices.csv", { type: "text/csv" }) as unknown as File);
    entries.set("paymentFile", new NodeFile([
      "Payment Date,Amount,Payer Name,Bank Reference,Transaction ID,Currency\n2026-07-02,100.00,Acme LLC,INV-1,TX-CARRIED,USD\n2026-07-03,50.00,Acme LLC,INV-1,TX-RESOLVED,USD\n",
    ], "payments.csv", { type: "text/csv" }) as unknown as File);

    const { POST } = await import("@/app/api/reconciliation/run/route");
    const response = await POST({
      url: `https://invoicereconcile.com/api/reconciliation/run?workspaceId=${workspaceId}`,
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => ({ get: (key: string) => entries.get(key) ?? null }),
    } as unknown as Request);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      importSummary: {
        paymentsAccepted: 2,
        paymentsActiveInRun: 1,
        paymentsNew: 0,
        paymentsPreviouslyImported: 2,
        paymentsCarriedForward: 1,
        paymentsAlreadyResolved: 1,
      },
      counts: { payments: 1 },
    });
    const reserveCall = rpc.mock.calls.find(([name]) => name === "reserve_reconciliation_capacity");
    expect(reserveCall?.[1]).toMatchObject({ p_payment_count: 0 });
    expect(savedSnapshot).toMatchObject({
      usagePaymentCount: 0,
      payments: [expect.objectContaining({ amountMinor: 3_500, transactionId: "TX-CARRIED" })],
    });
    expect(savedPaymentImport?.rows).toHaveLength(2);
    expect(savedPaymentImport?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        disposition: "accepted",
        rawValues: expect.objectContaining({ "Transaction ID": "TX-RESOLVED" }),
      }),
    ]));
  });

  it("reconciles bundled samples without a private upload when rate limiting is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const entries = new Map<string, FormDataEntryValue>();
    entries.set("workspaceId", "demo");
    const { POST } = await import("@/app/api/reconciliation/run/route");
    const request = {
      url: "https://invoicereconcile.com/api/reconciliation/run?workspaceId=demo&sample=1",
      headers: new Headers({ origin: "https://invoicereconcile.com" }),
      formData: async () => ({ get: (key: string) => entries.get(key) ?? null }),
    } as unknown as Request;
    const response = await POST(request);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      persistence: { status: "local", reason: "demo" },
      importSummary: {
        invoiceRows: 30,
        invoicesAccepted: 30,
        paymentRows: 22,
        paymentsAccepted: 21,
      },
    });
    expect(body.result.matches.length).toBeGreaterThan(0);
  });
});
