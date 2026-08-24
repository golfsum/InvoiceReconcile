import "server-only";

import { siteConfig } from "@/lib/config";
import { escapeHtml, sendTransactionalEmail } from "@/lib/email/postmark";

export type ContactMessage = {
  email: string;
  message: string;
  name: string;
  subject?: string;
  requestId: string;
};

export async function sendContactEmails(input: ContactMessage) {
  const safeName = escapeHtml(input.name);
  const safeEmail = escapeHtml(input.email);
  const safeSubject = escapeHtml(input.subject || "General question");
  const safeMessage = escapeHtml(input.message).replace(/\n/g, "<br>");

  const notification = await sendTransactionalEmail({
    to: siteConfig.supportEmail,
    replyTo: input.email,
    subject: `Contact request: ${input.subject || "General question"}`,
    tag: "contact-request",
    textBody: [
      `Contact request ${input.requestId}`,
      `From: ${input.name} <${input.email}>`,
      `Subject: ${input.subject || "General question"}`,
      "",
      input.message,
    ].join("\n"),
    htmlBody: `<h1>New contact request</h1><p><strong>Request:</strong> ${input.requestId}</p><p><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p><p><strong>Subject:</strong> ${safeSubject}</p><p>${safeMessage}</p>`,
  });

  const acknowledgement = await sendTransactionalEmail({
    to: input.email,
    replyTo: siteConfig.supportEmail,
    subject: "We received your InvoiceReconcile message",
    tag: "contact-confirmation",
    textBody: `Hi ${input.name},\n\nWe received your message and will reply from ${siteConfig.supportEmail}. Your request reference is ${input.requestId}.\n\nInvoiceReconcile Support`,
    htmlBody: `<p>Hi ${safeName},</p><p>We received your message and will reply from <a href="mailto:${siteConfig.supportEmail}">${siteConfig.supportEmail}</a>.</p><p>Your request reference is <strong>${input.requestId}</strong>.</p><p>InvoiceReconcile Support</p>`,
  });

  return { notification, acknowledgement };
}
