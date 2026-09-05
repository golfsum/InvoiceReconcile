import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("postmark", () => ({ ServerClient: class { sendEmail = sendEmail; }, Models: { LinkTrackingOptions: { None: "None" } } }));
beforeEach(() => {
  vi.stubEnv("POSTMARK_SERVER_TOKEN", "test-token");
  vi.stubEnv("POSTMARK_FROM_EMAIL", "notifications@invoicereconcile.com");
  vi.stubEnv("POSTMARK_MESSAGE_STREAM", "invoicereconcile");
  vi.stubEnv("CONTACT_NOTIFICATION_EMAIL", "contact@invoicereconcile.com");
  sendEmail.mockResolvedValue({ MessageID: "test-message" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.resetModules(); });
describe("InvoiceReconcile email roles", () => {
  it("sends automatic notifications separately from the support reply address", async () => {
    const { sendTransactionalEmail } = await import("@/lib/email/postmark");
    await sendTransactionalEmail({ to: "recipient@example.com", subject: "Test", textBody: "Test", htmlBody: "<p>Test</p>", tag: "test" });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      From: "InvoiceReconcile <notifications@invoicereconcile.com>", ReplyTo: "support@invoicereconcile.com",
      MessageStream: "invoicereconcile", TrackOpens: false, TrackLinks: "None",
    }));
  });
  it("routes general enquiries and acknowledgement replies to contact", async () => {
    const { sendContactEmails } = await import("@/lib/email/contact");
    await sendContactEmails({ email: "sender@example.com", name: "Casey", subject: "general", message: "Question", requestId: "test-request" });
    expect(sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ To: "contact@invoicereconcile.com", ReplyTo: "sender@example.com" }));
    expect(sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ To: "sender@example.com", ReplyTo: "contact@invoicereconcile.com" }));
  });
  it.each(["product", "account", "billing", "privacy", "security", "legal", "unknown", undefined])("keeps %s requests and replies in support", async (subject) => {
    const { sendContactEmails } = await import("@/lib/email/contact");
    await sendContactEmails({ email: "sender@example.com", name: "Casey", subject, message: "Question", requestId: "test-request" });
    expect(sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ To: "support@invoicereconcile.com" }));
    expect(sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ ReplyTo: "support@invoicereconcile.com" }));
  });
});
