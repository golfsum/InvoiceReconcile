import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("postmark", () => ({
  Models: { LinkTrackingOptions: { None: "None" } },
  ServerClient: class {
    sendEmail = sendEmail;
  },
}));

afterEach(() => {
  delete process.env.POSTMARK_SERVER_TOKEN;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("team invitation email", () => {
  it("escapes organization content and uses the support address without putting the invitee in a URL", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "test-token";
    sendEmail.mockResolvedValue({ MessageID: "message-1" });
    const { sendTeamInvitationEmail } = await import("@/lib/email/team-invitation");

    await sendTeamInvitationEmail({
      email: "invitee@example.com",
      organizationName: `<img src=x onerror="alert(1)"> Morgan Books`,
      role: "viewer",
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const payload = sendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.To).toBe("invitee@example.com");
    expect(payload.ReplyTo).toBe("support@invoicereconcile.com");
    expect(String(payload.HtmlBody)).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Morgan Books");
    expect(String(payload.HtmlBody)).not.toContain("<img src=x");
    expect(String(payload.HtmlBody)).not.toContain("invitee%40example.com");
    expect(String(payload.TextBody)).toContain("The invitation expires in seven days.");
  });
});
