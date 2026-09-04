import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "11000000-0000-4000-8000-000000000001";

type SupabaseOptions = {
  user?: { id: string } | null;
  authError?: { code: string } | null;
  workspace?: { id: string } | null;
  workspaceError?: { code: string } | null;
  mappings?: unknown[];
  mappingsError?: { code: string } | null;
};

function supabaseMock(options: SupabaseOptions = {}) {
  const workspaceMaybeSingle = vi.fn(async () => ({
    data: options.workspace === undefined ? { id: workspaceId } : options.workspace,
    error: options.workspaceError ?? null,
  }));
  const workspaceEq = vi.fn(() => ({ maybeSingle: workspaceMaybeSingle }));
  const workspaceSelect = vi.fn(() => ({ eq: workspaceEq }));

  const limit = vi.fn(async () => ({
    data: (options.mappings ?? []).map((column_mapping) => ({ column_mapping })),
    error: options.mappingsError ?? null,
  }));
  const secondOrder = vi.fn(() => ({ limit }));
  const firstOrder = vi.fn(() => ({ order: secondOrder }));
  const statusIn = vi.fn(() => ({ order: firstOrder }));
  const importTypeEq = vi.fn(() => ({ in: statusIn }));
  const workspaceIdEq = vi.fn(() => ({ eq: importTypeEq }));
  const importsSelect = vi.fn(() => ({ eq: workspaceIdEq }));

  const from = vi.fn((table: string) => {
    if (table === "workspaces") return { select: workspaceSelect };
    if (table === "imports") return { select: importsSelect };
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    client: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: options.user === undefined ? { id: "a0000000-0000-4000-8000-000000000001" } : options.user },
          error: options.authError ?? null,
        })),
      },
      from,
    },
  };
}

function sampleRequest(kind: "invoice" | "payment" = "invoice", workspace = "demo") {
  return new Request("https://invoicereconcile.com/api/imports/samples", {
    method: "POST",
    headers: { origin: "https://invoicereconcile.com", "content-type": "application/json" },
    body: JSON.stringify({ kind, workspaceId: workspace }),
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/supabase/server");
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("bundled sample import route", () => {
  it("keeps bundled samples identical to the public downloadable files", () => {
    for (const name of ["northstar-invoices.csv", "northstar-payments.csv"]) {
      const publicFile = readFileSync(join(process.cwd(), "public", "sample-data", name));
      const bundled = readFileSync(join(process.cwd(), "src", "lib", "imports", "samples", name));
      expect(bundled.equals(publicFile)).toBe(true);
    }
  });

  it("returns the bundled invoice sample without a private upload", async () => {
    const { POST } = await import("@/app/api/imports/samples/route");
    const response = await POST(sampleRequest("invoice"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "invoice",
      rowCount: 30,
      sample: true,
      file: { name: "northstar-invoices.csv" },
      mapping: {
        invoiceNumber: "Invoice Number",
        customerName: "Customer Name",
        invoiceDate: "Invoice Date",
        originalAmount: "Original Amount",
      },
    });
  });

  it("loads samples when production rate limiting is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const { POST } = await import("@/app/api/imports/samples/route");
    const response = await POST(sampleRequest("payment"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      kind: "payment",
      rowCount: 22,
      sample: true,
      file: { name: "northstar-payments.csv" },
    });
  });

  it("requires an authenticated user before loading samples into a live workspace", async () => {
    const mock = supabaseMock({ user: null });
    vi.doMock("@/lib/supabase/server", () => ({
      getSupabaseServerClient: vi.fn(async () => mock.client),
    }));
    const { POST } = await import("@/app/api/imports/samples/route");
    const response = await POST(sampleRequest("invoice", workspaceId));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Sign in") });
  });
});
