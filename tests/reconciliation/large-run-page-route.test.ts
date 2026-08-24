import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "31000000-0000-4000-8000-000000000001";

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("large saved-run page route", () => {
  it("rejects an unbounded page before calling the read model", async () => {
    const loadLatestReconciliationPage = vi.fn();
    vi.doMock("@/lib/reconciliation/large-run", () => ({ loadLatestReconciliationPage }));
    const { GET } = await import("@/app/api/reconciliation/runs/latest/items/route");
    const response = await GET(new Request(
      `https://invoicereconcile.com/api/reconciliation/runs/latest/items?workspaceId=${workspaceId}&type=match&limit=10000`,
    ));
    expect(response.status).toBe(400);
    expect(loadLatestReconciliationPage).not.toHaveBeenCalled();
  });

  it("forwards only bounded paging, search, and filter fields", async () => {
    const page = {
      runRecordId: "71000000-0000-4000-8000-000000000001",
      runKey: "behavior-key",
      completedAt: "2026-08-23T20:00:00.000Z",
      itemType: "match" as const,
      offset: 50,
      limit: 50,
      total: 10_000,
      hasMore: true,
      items: [],
      relatedInvoices: [],
      relatedPayments: [],
      decisions: {},
    };
    const loadLatestReconciliationPage = vi.fn(async () => ({ status: "ready" as const, data: page }));
    vi.doMock("@/lib/reconciliation/large-run", () => ({ loadLatestReconciliationPage }));
    const { GET } = await import("@/app/api/reconciliation/runs/latest/items/route");
    const response = await GET(new Request(
      `https://invoicereconcile.com/api/reconciliation/runs/latest/items?workspaceId=${workspaceId}&type=match&offset=50&limit=50&search=acme&status=review`,
    ));
    expect(response.status).toBe(200);
    expect(loadLatestReconciliationPage).toHaveBeenCalledWith({
      workspaceId,
      itemType: "match",
      offset: 50,
      limit: 50,
      search: "acme",
      status: "review",
    });
    await expect(response.json()).resolves.toMatchObject({ total: 10_000, items: [] });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["unavailable", 503],
    ["empty", 404],
    ["legacy", 409],
  ] as const)("returns an explicit %s read state", async (status, expectedStatus) => {
    vi.doMock("@/lib/reconciliation/large-run", () => ({
      loadLatestReconciliationPage: vi.fn(async () => ({ status })),
    }));
    const { GET } = await import("@/app/api/reconciliation/runs/latest/items/route");
    const response = await GET(new Request(
      `https://invoicereconcile.com/api/reconciliation/runs/latest/items?workspaceId=${workspaceId}&type=invoice&limit=50`,
    ));
    expect(response.status).toBe(expectedStatus);
  });
});
