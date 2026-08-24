import "server-only";

import { siteConfig } from "@/lib/config";
import { escapeHtml, sendTransactionalEmail } from "./postmark";

export type TeamInvitationEmail = {
  email: string;
  organizationName: string;
  role: "member" | "viewer";
};

export async function sendTeamInvitationEmail(input: TeamInvitationEmail) {
  const signupUrl = new URL("/auth/sign-up", siteConfig.url);
  signupUrl.searchParams.set("returnTo", "/auth/accept-invite");
  signupUrl.searchParams.set("source", "referral");
  const signInUrl = new URL("/auth/sign-in", siteConfig.url);
  signInUrl.searchParams.set("returnTo", "/auth/accept-invite");
  const safeOrganization = escapeHtml(input.organizationName);
  const safeRole = escapeHtml(input.role);
  const safeSignupUrl = escapeHtml(signupUrl.toString());
  const safeSignInUrl = escapeHtml(signInUrl.toString());

  return sendTransactionalEmail({
    to: input.email,
    replyTo: siteConfig.supportEmail,
    subject: `Join ${input.organizationName} in InvoiceReconcile`,
    tag: "team-invitation",
    textBody: [
      `An organization administrator invited you to join ${input.organizationName} in InvoiceReconcile as a ${input.role}.`,
      "",
      `Create an account with this email address: ${signupUrl.toString()}`,
      `Already have an account? Sign in: ${signInUrl.toString()}`,
      "",
      "The invitation expires in seven days. InvoiceReconcile will verify that your signed-in email matches the invitation before granting access.",
      `Questions? Contact ${siteConfig.supportEmail}.`,
    ].join("\n"),
    htmlBody: `<p>An organization administrator invited you to join <strong>${safeOrganization}</strong> in InvoiceReconcile as a <strong>${safeRole}</strong>.</p><p><a href="${safeSignupUrl}">Create an account with this email address</a></p><p>Already have an account? <a href="${safeSignInUrl}">Sign in to accept the invitation</a>.</p><p>The invitation expires in seven days. InvoiceReconcile verifies that your signed-in email matches the invitation before granting access.</p><p>Questions? Contact <a href="mailto:${siteConfig.supportEmail}">${siteConfig.supportEmail}</a>.</p>`,
  });
}
