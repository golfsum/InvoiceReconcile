import "server-only";

import { redirect } from "next/navigation";
import { readDemoSession, demoModeEnabled } from "@/lib/auth/demo-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: "member" | "admin";
  source: "supabase" | "demo";
};

function adminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function getCurrentUser(options: { allowPublicDemo?: boolean } = {}): Promise<AppUser | null> {
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user?.email) {
      let internalAdmin = adminEmails().has(data.user.email.toLowerCase());
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name,is_internal_admin,last_seen_at")
        .eq("id", data.user.id)
        .maybeSingle();
      const lastSeenAt = profile?.last_seen_at ? new Date(profile.last_seen_at).getTime() : 0;
      if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt > 15 * 60_000) {
        await supabase
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", data.user.id);
      }
      internalAdmin ||= profile?.is_internal_admin === true;
      return {
        id: data.user.id,
        email: data.user.email,
        name: profile?.display_name || data.user.user_metadata.full_name || data.user.email.split("@")[0],
        role: internalAdmin ? "admin" : "member",
        source: "supabase",
      };
    }
  }

  const demo = await readDemoSession();
  if (demo) return { id: demo.sub, email: demo.email, name: demo.name, role: demo.role, source: "demo" };
  if (options.allowPublicDemo && demoModeEnabled()) {
    return { id: "public-demo", email: "bookkeeper@demo.invoicereconcile.com", name: "Jordan Lee", role: "member", source: "demo" };
  }
  return null;
}

export async function requireUser(returnTo = "/app") {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/auth/sign-in?error=admin_required&returnTo=/admin");
  return user;
}
