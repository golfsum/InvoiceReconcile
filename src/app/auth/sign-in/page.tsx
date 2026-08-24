import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/auth-form";
import { safeReturnPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <AuthShell title="Welcome back" description="Sign in to continue a reconciliation or review client exceptions."><SignInForm returnTo={safeReturnPath(typeof query.returnTo === "string" ? query.returnTo : null, "/app")} /></AuthShell>;
}
