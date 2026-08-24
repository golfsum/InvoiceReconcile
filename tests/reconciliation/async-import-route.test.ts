import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "31000000-0000-4000-8000-000000000001";
const sourceId = "61000000-0000-4000-8000-000000000001";
const storagePath = `30000000-0000-4000-8000-000000000001/${workspaceId}/${sourceId}/71000000-0000-4000-8000-000000000001/source.csv`;

type RouteOptions = {
  configured?: boolean;
  user?: { id: string } | null;
  authError?: { code: string } | null;
  initializeError?: { code: string } | null;
  capability?: Record<string, unknown> | null;
  capabilityError?: { code: string } | null;
  workflowError?: Error | null;
  signedError?: { code: string } | null;
};

function request() {
  return new Request("https://invoicereconcile.com/api/imports/sources", {
    method: "POST",
    headers: { origin: "https://invoicereconcile.com", "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      kind: "invoice",
      sourceType: "csv",
      byteSize: 12,
      sha256: "a".repeat(64),
      idempotencyKey: "81000000-0000-4000-8000-000000000001",
    }),
  });
}

async function runRoute(options: RouteOptions = {}) {
  const initializeRpc = vi.fn(async () => ({
    data: options.initializeError ? null : {
      source_id: sourceId,
      storage_path: storagePath,
      upload_expires_at: "2026-08-24T00:15:00.000Z",
      status: "awaiting_upload",
    },
    error: options.initializeError ?? null,
  }));
  const registerRpc = vi.fn(async () => ({
    data: options.capability === null ? null : options.capability ?? {
      source_id: sourceId,
      storage_bucket: "import-source-files",
      storage_path: storagePath,
      safe_delete_at: "2026-08-24T02:05:00.000Z",
    },
    error: options.capabilityError ?? null,
  }));
  const createSignedUploadUrl = vi.fn(async () => ({
    data: options.signedError ? null : { signedUrl: "https://storage.example.test/signed-upload-token" },
    error: options.signedError ?? null,
  }));
  const authClient = options.configured === false ? null : {
    auth: { getUser: vi.fn(async () => ({
      data: { user: options.user === undefined ? { id: "d0000000-0000-4000-8000-000000000001" } : options.user },
      error: options.authError ?? null,
    })) },
    rpc: initializeRpc,
  };
  const serviceClient = options.configured === false ? null : {
    rpc: registerRpc,
    storage: { from: vi.fn(() => ({ createSignedUploadUrl })) },
  };
  const start = options.workflowError
    ? vi.fn(async () => { throw options.workflowError; })
    : vi.fn(async () => ({ runId: "workflow-run" }));

  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => authClient) }));
  vi.doMock("@/lib/supabase/service", () => ({ getSupabaseServiceClient: vi.fn(() => serviceClient) }));
  vi.doMock("workflow/api", () => ({ start }));
  vi.doMock("@/workflows/import-source", () => ({ importSourceLifecycleWorkflow: vi.fn() }));
  const { POST } = await import("@/app/api/imports/sources/route");
  return {
    response: await POST(request()),
    initializeRpc,
    registerRpc,
    createSignedUploadUrl,
    start,
  };
}

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("durable import source initialization route", () => {
  it("fails closed when private import dependencies are unavailable", async () => {
    const { response } = await runRoute({ configured: false });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("requires an authenticated user", async () => {
    const { response, initializeRpc } = await runRoute({ user: null });
    expect(response.status).toBe(401);
    expect(initializeRpc).not.toHaveBeenCalled();
  });

  it("returns forbidden without workspace editor authority", async () => {
    const { response } = await runRoute({ initializeError: { code: "42501" } });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("permission") });
  });

  it("does not register or issue a capability when lifecycle scheduling fails", async () => {
    const { response, registerRpc, createSignedUploadUrl } = await runRoute({ workflowError: new Error("queue unavailable") });
    expect(response.status).toBe(503);
    expect(registerRpc).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("issues only the registered exact path with overwrite disabled", async () => {
    const { response, initializeRpc, registerRpc, createSignedUploadUrl, start } = await runRoute();
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      sourceId,
      contentType: "text/csv",
      maxBytes: 50 * 1024 * 1024,
    });
    expect(initializeRpc).toHaveBeenCalledWith("initialize_async_import_source", expect.objectContaining({
      p_workspace_id: workspaceId,
      p_expected_sha256: "a".repeat(64),
    }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(registerRpc).toHaveBeenCalledWith("worker_register_async_import_upload_capability", { p_source_id: sourceId });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(storagePath, { upsert: false });
  });

  it("fails closed if capability registration returns a different path", async () => {
    const { response, createSignedUploadUrl } = await runRoute({
      capability: {
        source_id: sourceId,
        storage_bucket: "import-source-files",
        storage_path: "30000000-0000-4000-8000-000000000001/wrong.csv",
        safe_delete_at: "2026-08-24T02:05:00.000Z",
      },
    });
    expect(response.status).toBe(503);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
