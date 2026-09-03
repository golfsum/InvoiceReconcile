import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { safeReturnPath } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Account created",
  robots: { index: false, follow: false },
};

export default async function AccountCreatedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const returnTo = safeReturnPath(
    typeof query.returnTo === "string" ? query.returnTo : null,
    "/onboarding",
  );
  const deliveryDelayed = query.delivery === "delayed";
  const signInReturnTo = returnTo === "/onboarding" ? "/app" : returnTo;

  return (
    <AuthShell
      title="Your account was created."
      description={deliveryDelayed
        ? "Your confirmation email is delayed because the email service is busy. Your account is safe and does not need to be created again."
        : "Check your inbox to confirm your email address, then sign in to create your first workspace."}
    >
      <div className="border border-success/25 bg-success-soft p-5 text-success">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Account details saved</p>
            <p className="mt-1 text-sm leading-6">
              {deliveryDelayed
                ? "Wait a few minutes, then request a new confirmation email below."
                : "Open the confirmation link in your email. It will return you to InvoiceReconcile."}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-3">
        <Link
          className={buttonVariants({ size: "lg" })}
          href={`/auth/sign-in?returnTo=${encodeURIComponent(signInReturnTo)}`}
        >
          Continue to sign in
        </Link>
        <Link
          className={buttonVariants({ variant: "secondary", size: "lg" })}
          href={`/auth/resend-confirmation?returnTo=${encodeURIComponent(returnTo)}`}
        >
          <Mail className="size-4" />
          Resend confirmation email
        </Link>
      </div>
    </AuthShell>
  );
}
