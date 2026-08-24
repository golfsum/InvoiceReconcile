import "server-only";

import { ServerClient } from "postmark";
import { z } from "zod";
import { siteConfig } from "@/lib/config";

const emailAddressSchema = z.string().trim().email().max(320);
const emailTagSchema = z.string().regex(/^[a-z0-9_-]{1,100}$/);

export type TransactionalEmail = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  replyTo?: string;
  tag: string;
};

export type EmailDeliveryResult =
  | { delivered: true; mode: "postmark"; messageId: string }
  | { delivered: false; mode: "demo" | "unavailable"; code: string };

let postmarkClient: ServerClient | null = null;

function getPostmarkClient() {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  if (!token) return null;
  postmarkClient ??= new ServerClient(token);
  return postmarkClient;
}

function fromAddress() {
  return emailAddressSchema.safeParse(process.env.POSTMARK_FROM_EMAIL).success
    ? process.env.POSTMARK_FROM_EMAIL!.trim()
    : siteConfig.supportEmail;
}

export async function sendTransactionalEmail(input: TransactionalEmail): Promise<EmailDeliveryResult> {
  const to = emailAddressSchema.safeParse(input.to);
  const replyTo = input.replyTo ? emailAddressSchema.safeParse(input.replyTo) : null;
  const tag = emailTagSchema.safeParse(input.tag);
  if (!to.success || (replyTo && !replyTo.success) || !tag.success) {
    return { delivered: false, mode: "unavailable", code: "invalid_email_payload" };
  }

  const client = getPostmarkClient();
  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      return { delivered: false, mode: "demo", code: "postmark_not_configured" };
    }
    return { delivered: false, mode: "unavailable", code: "postmark_not_configured" };
  }

  try {
    const response = await client.sendEmail({
      From: `InvoiceReconcile <${fromAddress()}>`,
      To: to.data,
      Subject: input.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
      TextBody: input.textBody,
      HtmlBody: input.htmlBody,
      ReplyTo: replyTo?.success ? replyTo.data : undefined,
      Tag: tag.data,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
      TrackOpens: false,
    });
    return { delivered: true, mode: "postmark", messageId: response.MessageID };
  } catch {
    return { delivered: false, mode: "unavailable", code: "postmark_send_failed" };
  }
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character]!);
}
