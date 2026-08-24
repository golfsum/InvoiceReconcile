import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "31000000-0000-4000-8000-000000000001";
const userId = "d0000000-0000-4000-8000-000000000001";
const notificationId = "91000000-0000-4000-8000-000000000001";

type Options = {
  user?: { id: string } | null;
  readError?: { code: string } | null;
  writeError?: { code: string } | null;
};

function clientMock(options: Options = {}) {
  const limit = vi.fn(async () => ({
    data: options.readError ? null : [{
      id: notificationId,
      event_type: "reconciliation_ready",
      title: "Reconciliation ready",
      body: "Your saved run is ready to review.",
      action_path: `/app/${workspaceId}/exceptions`,
      read_at: null,
      created_at: "2026-08-23T20:00:00.000Z",
    }],
    error: options.readError ?? null,
  }));
  const order = vi.fn(() => ({ limit }));
  const readUserEq = vi.fn(() => ({ order }));
  const readWorkspaceEq = vi.fn(() => ({ eq: readUserEq }));
  const select = vi.fn(() => ({ eq: readWorkspaceEq }));

  const inIds = vi.fn(async () => ({ error: options.writeError ?? null }));
  const writeUserEq = vi.fn(() => ({ in: inIds }));
  const writeWorkspaceEq = vi.fn(() => ({ eq: writeUserEq }));
  const update = vi.fn(() => ({ eq: writeWorkspaceEq }));

  return {
    client: {
      auth: { getUser: vi.fn(async () => ({
        data: { user: options.user === undefined ? { id: userId } : options.user },
        error: null,
      })) },
      from: vi.fn(() => ({ select, update })),
    },
    limit,
    readWorkspaceEq,
    readUserEq,
    update,
    writeWorkspaceEq,
    writeUserEq,
    inIds,
  };
}

async function routeWith(options: Options = {}) {
  const mock = clientMock(options);
  vi.doMock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn(async () => mock.client) }));
  const route = await import("@/app/api/notifications/route");
  return { route, mock };
}

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("workspace notifications route", () => {
  it("requires authentication", async () => {
    const { route } = await routeWith({ user: null });
    const response = await route.GET(new Request(`https://invoicereconcile.com/api/notifications?workspaceId=${workspaceId}`));
    expect(response.status).toBe(401);
  });

  it("returns only a bounded user and workspace scoped page", async () => {
    const { route, mock } = await routeWith();
    const response = await route.GET(new Request(`https://invoicereconcile.com/api/notifications?workspaceId=${workspaceId}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ notifications: [{ id: notificationId }] });
    expect(mock.readWorkspaceEq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(mock.readUserEq).toHaveBeenCalledWith("user_id", userId);
    expect(mock.limit).toHaveBeenCalledWith(20);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not translate an RLS denial into an empty notification page", async () => {
    const { route } = await routeWith({ readError: { code: "42501" } });
    const response = await route.GET(new Request(`https://invoicereconcile.com/api/notifications?workspaceId=${workspaceId}`));
    expect(response.status).toBe(403);
  });

  it("requires same origin and marks at most the validated user-owned IDs", async () => {
    const { route, mock } = await routeWith();
    const crossOrigin = await route.PATCH(new Request("https://invoicereconcile.com/api/notifications", {
      method: "PATCH",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, notificationIds: [notificationId] }),
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mock.update).not.toHaveBeenCalled();

    const response = await route.PATCH(new Request("https://invoicereconcile.com/api/notifications", {
      method: "PATCH",
      headers: { origin: "https://invoicereconcile.com", "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, notificationIds: [notificationId] }),
    }));
    expect(response.status).toBe(200);
    expect(mock.writeWorkspaceEq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(mock.writeUserEq).toHaveBeenCalledWith("user_id", userId);
    expect(mock.inIds).toHaveBeenCalledWith("id", [notificationId]);
  });
});
