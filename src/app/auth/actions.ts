"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { siteConfig } from "@/lib/config";
import { DEMO_COOKIE } from "@/lib/auth/demo-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeReturnPath } from "@/lib/utils";
import { paidPlanSchema } from "@/lib/billing/catalog";
import { onboardingPathForPlan } from "@/lib/billing/intent";

export type AuthState = { error?: string; message?: string };

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid business email."),
  password: z.string().min(8, "Password must have at least 8 characters."),
});

const signupSourceSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/).catch("unattributed");
const optionalPaidPlanSchema = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  paidPlanSchema.optional(),
);

function authCallbackUrl(nextPath: string) {
  const callbackUrl = new URL("/auth/callback", siteConfig.url);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}

export async function signInAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check your sign-in details." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Account sign-in is not configured in this environment. Use the sample workspace instead." };
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "We could not sign you in with those details. Check your email and password." };
  if (data.user) {
    await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
  }
  redirect(safeReturnPath(formData.get("returnTo")?.toString() || null, "/app"));
}

export async function signUpAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentialsSchema.extend({
    fullName: z.string().trim().min(2, "Enter your name."),
    businessName: z.string().trim().min(2, "Enter your business or firm name."),
    signupSource: signupSourceSchema,
    plan: optionalPaidPlanSchema,
  }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    businessName: formData.get("businessName"),
    signupSource: formData.get("signupSource"),
    plan: formData.get("plan"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the account details." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Account creation is not configured in this environment. Use the sample workspace instead." };
  const onboardingPath = onboardingPathForPlan(parsed.data.plan || null);
  const returnPath = safeReturnPath(formData.get("returnTo")?.toString() || null, onboardingPath);
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: authCallbackUrl(returnPath),
      data: {
        full_name: parsed.data.fullName,
        business_name: parsed.data.businessName,
        signup_source: parsed.data.signupSource,
        selected_plan: parsed.data.plan,
      },
    },
  });
  if (error) return { error: error.message.includes("registered") ? "An account already uses this email. Sign in instead." : "We could not create the account. Try again or contact support." };
  if (!data.session) return { message: "Check your email to verify the account, then return to sign in." };
  if (data.user) {
    const serviceClient = getSupabaseServiceClient();
    await serviceClient?.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
    await serviceClient?.from("analytics_events").insert({
      event_name: "signup_completed",
      user_id: data.user.id,
      path: "/auth/sign-up",
      utm_source: ["direct", "referral", "unattributed"].includes(parsed.data.signupSource) ? null : parsed.data.signupSource,
      properties: {
        source: ["direct", "referral"].includes(parsed.data.signupSource) ? parsed.data.signupSource : undefined,
      },
    });
  }
  redirect(returnPath);
}

export async function resendConfirmationAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().email("Enter a valid email.").safeParse(formData.get("email"));
  if (!email.success) return { error: email.error.issues[0]?.message };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Account confirmation is not configured in this environment." };
  const returnPath = safeReturnPath(formData.get("returnTo")?.toString() || null, "/onboarding");
  await supabase.auth.resend({
    type: "signup",
    email: email.data,
    options: { emailRedirectTo: authCallbackUrl(returnPath) },
  });
  return { message: "If that account still needs verification, a new confirmation email is on its way." };
}

export async function requestPasswordResetAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.string().trim().email("Enter a valid email.").safeParse(formData.get("email"));
  if (!email.success) return { error: email.error.issues[0]?.message };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Password reset is not configured in this environment." };
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: authCallbackUrl("/auth/reset-password"),
  });
  return { message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePasswordAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = z.object({
    password: z.string().min(8, "Password must have at least 8 characters."),
    confirmation: z.string(),
  }).refine((value) => value.password === value.confirmation, { message: "The passwords do not match.", path: ["confirmation"] }).safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the new password." };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Password reset is not configured in this environment." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "This reset link may have expired. Request a new password reset email." };
  return { message: "Your password has been updated. You can now return to the app." };
}

export async function signOutAction() {
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE);
  redirect("/");
}
