import "server-only";

import { z } from "zod";
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
  const configuredContact = z.string().trim().email().safeParse(process.env.CONTACT_NOTIFICATION_EMAIL);
  const contactEmail = configuredContact.success ? configuredContact.data : siteConfig.supportEmail;
  const safeName = escapeHtml(input.name);
  const safeEmail = escapeHtml(input.email);
  const safeSubject = escapeHtml(input.subject || "General question");
  const safeMessage = escapeHtml(input.message).replace(/\n/g, "<br>");

  const notification = await sendTransactionalEmail({
    to: contactEmail,
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
    replyTo: contactEmail,
    subject: "We received your InvoiceReconcile message",
    tag: "contact-confirmation",
    textBody: `Hi ${input.name},\n\nWe received your message and will reply from ${contactEmail}. Your request reference is ${input.requestId}.\n\nInvoiceReconcile`,
    htmlBody: `<p>Hi ${safeName},</p><p>We received your message and will reply from <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</p><p>Your request reference is <strong>${input.requestId}</strong>.</p><p>InvoiceReconcile</p>`,
  });

  return { notification, acknowledgement };
}
