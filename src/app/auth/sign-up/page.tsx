import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/auth-form";
import { selectedPaidPlan } from "@/lib/billing/intent";
import { safeReturnPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Create account", robots: { index: false, follow: false } };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const plan = selectedPaidPlan(query.plan);
  const returnTo = safeReturnPath(typeof query.returnTo === "string" ? query.returnTo : null, "/onboarding");
  const invitation = returnTo === "/auth/accept-invite";
  const source = query.source === "referral" ? "referral" : undefined;
  return <AuthShell title={invitation ? "Join your InvoiceReconcile team" : "Reconcile your first file"} description={invitation ? "Create an account with the email that received the invitation. After verification, review and accept the organization access." : "Create a workspace, upload invoices and payments, and see the exceptions without entering a card."}><SignUpForm selectedPlan={plan || undefined} returnTo={invitation ? returnTo : undefined} signupSource={source} /></AuthShell>;
}
