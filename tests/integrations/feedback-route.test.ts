import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCurrentUser = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const getSupabaseServiceClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/access", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));

const workspaceId = "11000000-0000-4000-8000-000000000001";
const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";

function request(workspace = workspaceId) {
  return new Request("https://invoicereconcile.com/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://invoicereconcile.com",
    },
    body: JSON.stringify({ priorWorkflow: "excel", workspaceId: workspace }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: "user-1",
    source: "supabase",
    email: "owner@example.com",
    name: "Owner",
    role: "member",
  });
});

afterEach(async () => {
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
});

describe("feedback route storage boundary", () => {
  it("uses the user client only to verify scope and the service client to write", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: workspaceId, organization_id: organizationId },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const userFrom = vi.fn().mockReturnValue({ select });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const serviceFrom = vi.fn().mockReturnValue({ insert });
    getSupabaseServerClient.mockResolvedValue({ from: userFrom });
    getSupabaseServiceClient.mockReturnValue({ from: serviceFrom });
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(userFrom).toHaveBeenCalledWith("workspaces");
    expect(userFrom).not.toHaveBeenCalledWith("feedback");
    expect(serviceFrom).toHaveBeenCalledWith("feedback");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1",
      organization_id: organizationId,
      workspace_id: workspaceId,
      status: "new",
    }));
  });

  it("does not downgrade an inaccessible requested workspace to unscoped feedback", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const userFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle }),
      }),
    });
    getSupabaseServerClient.mockResolvedValue({ from: userFrom });
    const { POST } = await import("@/app/api/feedback/route");

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });
});
