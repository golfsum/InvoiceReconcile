import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createDemoToken = vi.hoisted(() => vi.fn().mockResolvedValue("signed-demo-token"));
vi.mock("@/lib/auth/demo-session", () => ({
  createDemoToken,
  DEMO_COOKIE: "ir_demo_session",
  demoModeEnabled: () => true,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("production demo session role", () => {
  it("clamps an admin-shaped form submission to a member session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const form = new FormData();
    form.set("role", "admin");
    form.set("returnTo", "/admin");
    const { POST } = await import("@/app/api/demo/session/route");

    const response = await POST(new Request("https://invoicereconcile.com/api/demo/session", {
      method: "POST",
      body: form,
    }));

    expect(createDemoToken).toHaveBeenCalledWith("member");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin");
  });
});
