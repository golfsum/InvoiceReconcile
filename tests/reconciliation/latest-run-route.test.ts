import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLatest: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/reconciliation/live", () => ({ loadLatestReconciliationRun: mocks.loadLatest }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } }, error: null });
  mocks.loadLatest.mockReset();
});

describe("latest reconciliation run route", () => {
  const url = "https://invoicereconcile.com/api/reconciliation/runs/latest?workspaceId=11000000-0000-4000-8000-000000000001";

  it("returns 503 instead of an empty workspace when saved data is unavailable", async () => {
    mocks.loadLatest.mockResolvedValue({ status: "unavailable" });
    const { GET } = await import("@/app/api/reconciliation/runs/latest/route");
    const response = await GET(new Request(url));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("temporarily unavailable") });
  });

  it("returns 404 only for an authenticated, successful empty lookup", async () => {
    mocks.loadLatest.mockResolvedValue({ status: "empty" });
    const { GET } = await import("@/app/api/reconciliation/runs/latest/route");
    const response = await GET(new Request(url));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("No saved reconciliation run") });
  });

  it("returns a durable snapshot for a ready lookup", async () => {
    const data = {
      runId: "saved-run-12345678",
      invoices: [],
      payments: [],
      result: { matches: [], duplicates: [], summary: { exact: 0, highConfidence: 0, review: 0, unmatched: 0 } },
      persistence: { status: "durable", runRecordId: "11700000-0000-4000-8000-000000000001", savedAt: "2026-08-23T12:00:00.000Z" },
    };
    mocks.loadLatest.mockResolvedValue({ status: "ready", data });
    const { GET } = await import("@/app/api/reconciliation/runs/latest/route");
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ runId: data.runId, persistence: { status: "durable" } });
  });
});
