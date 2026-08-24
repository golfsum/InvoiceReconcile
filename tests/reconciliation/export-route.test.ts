import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(async () => {
  vi.unstubAllEnvs();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("reconciliation export route", () => {
  it("rejects a cross-site export before reading authentication state", async () => {
    const { POST } = await import("@/app/api/reconciliation/exports/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/reconciliation/exports", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({}),
    }));
    expect(response.status).toBe(403);
  });

  it("rejects an unrecognized export type before accessing storage", async () => {
    const { POST } = await import("@/app/api/reconciliation/exports/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/reconciliation/exports", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://invoicereconcile.com" },
      body: JSON.stringify({
        workspaceId: "11000000-0000-4000-8000-000000000001",
        runRecordId: "11700000-0000-4000-8000-000000000001",
        exportType: "raw-source-files",
        fileType: "csv",
        rowCount: 1,
        idempotencyKey: "11700000-0000-4000-8000-000000000002",
      }),
    }));
    expect(response.status).toBe(400);
  });
});
