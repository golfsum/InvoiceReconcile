import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResendConfirmationForm } from "@/components/auth/auth-form";
import { safeReturnPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Resend confirmation", robots: { index: false, follow: false } };

export default async function ResendConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const returnTo = safeReturnPath(typeof query.returnTo === "string" ? query.returnTo : null, "/onboarding");
  return <AuthShell title="Send a new confirmation" description="Use the same email you registered with. The replacement link will return to InvoiceReconcile."><ResendConfirmationForm returnTo={returnTo} /></AuthShell>;
}
