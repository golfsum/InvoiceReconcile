import "server-only";

import { siteConfig } from "@/lib/config";
import { sendTransactionalEmail } from "./postmark";

type ImportStatusEmail = {
  to: string;
  workspaceId: string;
  event: "preview_ready" | "preview_failed" | "reconciliation_ready" | "reconciliation_failed";
};

const copy = {
  preview_ready: {
    subject: "Your import is ready to map",
    heading: "Your import is ready to map",
    body: "InvoiceReconcile finished validating the private source. Return to your workspace to confirm the column mapping.",
    path: "imports",
  },
  preview_failed: {
    subject: "Your import needs attention",
    heading: "Your import needs attention",
    body: "InvoiceReconcile stopped safely because the source could not be validated. Return to your workspace to review the file requirements and try again.",
    path: "imports",
  },
  reconciliation_ready: {
    subject: "Your reconciliation is ready",
    heading: "Your reconciliation is ready",
    body: "InvoiceReconcile saved the background run. Return to your workspace to review exceptions and approve the results.",
    path: "exceptions",
  },
  reconciliation_failed: {
    subject: "Your reconciliation needs attention",
    heading: "Your reconciliation needs attention",
    body: "InvoiceReconcile stopped safely before saving a run. Return to your workspace to review the import and retry.",
    path: "imports",
  },
} as const;

export async function sendImportStatusEmail(input: ImportStatusEmail) {
  const message = copy[input.event];
  const actionUrl = new URL(`/app/${input.workspaceId}/${message.path}`, siteConfig.url).toString();
  return sendTransactionalEmail({
    to: input.to,
    replyTo: siteConfig.supportEmail,
    subject: message.subject,
    tag: `import-${input.event.replaceAll("_", "-")}`,
    textBody: `${message.heading}\n\n${message.body}\n\nOpen your workspace: ${actionUrl}\n\nQuestions? Contact ${siteConfig.supportEmail}.`,
    htmlBody: `<h1>${message.heading}</h1><p>${message.body}</p><p><a href="${actionUrl}">Open your workspace</a></p><p>Questions? Contact <a href="mailto:${siteConfig.supportEmail}">${siteConfig.supportEmail}</a>.</p>`,
  });
}
