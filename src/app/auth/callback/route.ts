import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { safeReturnPath } from "@/lib/utils";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeReturnPath(url.searchParams.get("next"), "/onboarding");
  const supabase = await getSupabaseServerClient();
  if (code && supabase) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) await getSupabaseServiceClient()?.from("analytics_events").insert({ event_name: "signup_completed", user_id: data.user.id, path: "/auth/callback", properties: { source: next === "/auth/accept-invite" ? "referral" : "email" } });
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/auth/sign-in?error=callback_failed", url.origin));
}
