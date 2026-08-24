import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const exchangeCodeForSession = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const analyticsInsert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { exchangeCodeForSession },
    rpc,
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: analyticsInsert })),
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("invitation authentication callback", () => {
  it("returns a verified user to the review page without silently accepting invitations", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    analyticsInsert.mockResolvedValue({ error: null });

    const { GET } = await import("@/app/auth/callback/route");
    const response = await GET(new Request("https://invoicereconcile.com/auth/callback?code=valid&next=%2Fauth%2Faccept-invite"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://invoicereconcile.com/auth/accept-invite");
    expect(rpc).not.toHaveBeenCalled();
    expect(analyticsInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: "signup_completed",
      properties: { source: "referral" },
    }));
  });
});
