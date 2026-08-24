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
    limit,
  };
}

function previewRequest() {
  const form = new FormData();
  form.set("kind", "invoice");
  form.set("workspaceId", workspaceId);
  form.set("file", new File([
    "Invoice #,Client,Issued,Gross,Notes\nINV-1,Acme LLC,2026-08-01,125.00,Current\n",
  ], "invoices.csv", { type: "text/csv" }));
  return {
    url: "https://invoicereconcile.com/api/imports/preview",
    headers: new Headers({ origin: "https://invoicereconcile.com" }),
    formData: async () => form,
  } as unknown as Request;
}

async function previewWith(options: SupabaseOptions) {
  const mock = supabaseMock(options);
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseServerClient: vi.fn(async () => mock.client),
  }));
  const { POST } = await import("@/app/api/imports/preview/route");
  return { response: await POST(previewRequest()), mock };
}

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("authenticated import preview mappings", () => {
  it("requires an authenticated user before loading workspace mappings", async () => {
    const { response } = await previewWith({ user: null });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Sign in") });
  });

  it("does not expose mappings when RLS hides the workspace", async () => {
    const { response } = await previewWith({ workspace: null });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("access") });
  });

  it("fails closed when saved mappings cannot be read", async () => {
    const { response } = await previewWith({ mappingsError: { code: "08006" } });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("No file was processed") });
  });

  it("reuses the newest compatible mapping from at most twenty recent imports", async () => {
    const { response, mock } = await previewWith({
      mappings: [
        { invoiceNumber: "Invoice #", customerName: "Missing customer", invoiceDate: "Issued", originalAmount: "Gross" },
        { invoiceNumber: "Invoice #", customerName: "Client", invoiceDate: "Issued", originalAmount: "Gross" },
        { invoiceNumber: "Legacy number", customerName: "Legacy client", invoiceDate: "Legacy date", originalAmount: "Legacy total" },
      ],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mappingSource: "saved",
      mapping: {
        invoiceNumber: "Invoice #",
        customerName: "Client",
        invoiceDate: "Issued",
        originalAmount: "Gross",
      },
    });
    expect(mock.limit).toHaveBeenCalledWith(20);
  });
});
