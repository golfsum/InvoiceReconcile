import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };
export default function ForgotPasswordPage() { return <AuthShell title="Reset your password" description="Enter the account email and we will send a time-limited reset link."><ForgotPasswordForm /></AuthShell>; }
