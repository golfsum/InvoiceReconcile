import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/auth-form";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/auth/forgot-password?error=reset_unavailable");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/auth/forgot-password?error=reset_link_required");
  return <AuthShell title="Choose a new password" description="Use at least eight characters and avoid a password used on another service."><ResetPasswordForm /></AuthShell>;
}
