import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const sendTeamInvitationEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email")>(),
  sendTeamInvitationEmail,
}));

const organizationId = "11000000-0000-4000-8000-000000000001";
const membershipId = "11800000-0000-4000-8000-000000000001";
const deliveryId = "11900000-0000-4000-8000-000000000001";

function request(method: "POST" | "DELETE", body: unknown, origin = "https://invoicereconcile.com") {
  return new Request(`https://invoicereconcile.com/api/organizations/${organizationId}/invitations`, {
    method,
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function invitation() {
  return {
    membershipId,
    organizationId,
    organizationName: "Morgan Books",
    invitedEmail: "colleague@example.com",
    role: "member",
    status: "invited",
    invitedAt: "2026-08-23T12:00:00.000Z",
    expiresAt: "2026-08-30T12:00:00.000Z",
    deliveryId,
    existing: false,
  };
}

function client(rpc: ReturnType<typeof vi.fn>) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc,
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("organization invitation route", () => {
  it("rejects a cross-site invitation before authentication", async () => {
    const { POST } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await POST(request("POST", { email: "colleague@example.com", role: "member" }, "https://attacker.example"), {
      params: Promise.resolve({ organizationId }),
    });
    expect(response.status).toBe(403);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("creates an audited invitation and sends the transactional email", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: invitation(), error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    sendTeamInvitationEmail.mockResolvedValue({ delivered: true, mode: "postmark", messageId: "message-1" });
    const { POST } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await POST(request("POST", { email: "COLLEAGUE@example.com", role: "member" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_organization_invitation", {
      p_organization_id: organizationId,
      p_email: "colleague@example.com",
      p_role: "member",
    });
    expect(sendTeamInvitationEmail).toHaveBeenCalledWith({
      email: "colleague@example.com",
      organizationName: "Morgan Books",
      role: "member",
    });
    await expect(response.json()).resolves.not.toHaveProperty("invitation.deliveryId");
  });

  it("rolls back a new invitation when production email delivery fails", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: invitation(), error: null })
      .mockResolvedValueOnce({ data: { membershipId, rolledBack: true }, error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    sendTeamInvitationEmail.mockResolvedValue({ delivered: false, mode: "unavailable", code: "postmark_send_failed" });
    const { POST } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await POST(request("POST", { email: "colleague@example.com", role: "member" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenNthCalledWith(2, "rollback_organization_invitation_delivery", {
      p_organization_id: organizationId,
      p_membership_id: membershipId,
      p_delivery_id: deliveryId,
    });
  });

  it("preserves a prior usable invitation when a resend email fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...invitation(), existing: true }, error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    sendTeamInvitationEmail.mockResolvedValue({ delivered: false, mode: "unavailable", code: "postmark_send_failed" });
    const { POST } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await POST(request("POST", { email: "colleague@example.com", role: "member" }), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("prior invitation remains active") });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns an upgrade response when the plan does not include team access", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "Team invitations require the Business or Bookkeeper plan" } });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await POST(request("POST", { email: "colleague@example.com", role: "member" }), {
      params: Promise.resolve({ organizationId }),
    });
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ upgradeRequired: true, upgradeUrl: "/settings/billing" });
    expect(sendTeamInvitationEmail).not.toHaveBeenCalled();
  });

  it("revokes a pending invitation through the organization-scoped RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { membershipId, revoked: true }, error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { DELETE } = await import("@/app/api/organizations/[organizationId]/invitations/route");
    const response = await DELETE(request("DELETE", { membershipId }), {
      params: Promise.resolve({ organizationId }),
    });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("revoke_organization_invitation", {
      p_organization_id: organizationId,
      p_membership_id: membershipId,
    });
  });
});
