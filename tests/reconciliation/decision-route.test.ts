import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));

afterEach(async () => {
  vi.unstubAllEnvs();
  getSupabaseServerClient.mockReset();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("reconciliation decision route", () => {
  it("rejects a cross-site decision before reading authentication state", async () => {
    const { POST } = await import("@/app/api/reconciliation/decisions/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/reconciliation/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({}),
    }));
    expect(response.status).toBe(403);
  });

  it("requires at least one invoice for a confirmed application", async () => {
    const { POST } = await import("@/app/api/reconciliation/decisions/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/reconciliation/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
      body: JSON.stringify({
        workspaceId: "11000000-0000-4000-8000-000000000001",
        runRecordId: "11700000-0000-4000-8000-000000000001",
        matchId: "match:test",
        outcome: "confirmed",
        allocations: [],
        appliedAmountMinor: 0,
        idempotencyKey: "11700000-0000-4000-8000-000000000002",
      }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Choose at least one invoice allocation." });
  });

  it("passes exact invoice amounts and the verified total to the allocation RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        decision: {
          matchId: "match:test",
          outcome: "confirmed",
          invoiceIds: ["invoice:one", "invoice:two"],
          allocations: [
            { invoiceId: "invoice:one", amountMinor: 6_000 },
            { invoiceId: "invoice:two", amountMinor: 4_000 },
          ],
          appliedAmountMinor: 10_000,
          decidedAt: "2026-08-23T12:00:00.000Z",
        },
      },
      error: null,
    });
    getSupabaseServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user:test" } }, error: null }) },
      rpc,
    });
    const { POST } = await import("@/app/api/reconciliation/decisions/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/reconciliation/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
      body: JSON.stringify({
        workspaceId: "11000000-0000-4000-8000-000000000001",
        runRecordId: "11700000-0000-4000-8000-000000000001",
        matchId: "match:test",
        outcome: "confirmed",
        allocations: [
          { invoiceId: "invoice:one", amountMinor: 6_000 },
          { invoiceId: "invoice:two", amountMinor: 4_000 },
        ],
        appliedAmountMinor: 10_000,
        note: "Verified remittance",
        feeMinor: 0,
        feedback: "correct",
        idempotencyKey: "11700000-0000-4000-8000-000000000002",
      }),
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_reconciliation_decision_v2", {
      p_workspace_id: "11000000-0000-4000-8000-000000000001",
      p_run_record_id: "11700000-0000-4000-8000-000000000001",
      p_client_match_id: "match:test",
      p_outcome: "confirmed",
      p_invoice_allocations: [
        { invoiceId: "invoice:one", amountMinor: 6_000 },
        { invoiceId: "invoice:two", amountMinor: 4_000 },
      ],
      p_applied_amount_minor: 10_000,
      p_note: "Verified remittance",
      p_fee_minor: 0,
      p_feedback: "correct",
      p_idempotency_key: "11700000-0000-4000-8000-000000000002",
    });
  });

  it("rejects duplicate invoices and inconsistent totals before accessing storage", async () => {
    const { POST } = await import("@/app/api/reconciliation/decisions/route");
    const base = {
      workspaceId: "11000000-0000-4000-8000-000000000001",
      runRecordId: "11700000-0000-4000-8000-000000000001",
      matchId: "match:test",
      outcome: "confirmed",
      idempotencyKey: "11700000-0000-4000-8000-000000000002",
    };
    const duplicateResponse = await POST(new Request("https://invoicereconcile.com/api/reconciliation/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
      body: JSON.stringify({
        ...base,
        allocations: [
          { invoiceId: "invoice:one", amountMinor: 2_000 },
          { invoiceId: "invoice:one", amountMinor: 2_000 },
        ],
        appliedAmountMinor: 4_000,
      }),
    }));
    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toMatchObject({ error: "Each invoice can appear only once." });

    const totalResponse = await POST(new Request("https://invoicereconcile.com/api/reconciliation/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
      body: JSON.stringify({
        ...base,
        allocations: [{ invoiceId: "invoice:one", amountMinor: 4_000 }],
        appliedAmountMinor: 3_000,
      }),
    }));
    expect(totalResponse.status).toBe(400);
    await expect(totalResponse.json()).resolves.toMatchObject({ error: "The applied total must equal the sum of the invoice allocations." });
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });
});
