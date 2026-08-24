import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?returnTo=/app");
  if (user.source === "supabase") {
    const supabase = await getSupabaseServerClient();
    const { data: memberships } = await supabase!.from("memberships").select("organization_id").eq("user_id", user.id).eq("status", "active");
    const organizationIds = (memberships || []).map((membership) => membership.organization_id as string);
    if (organizationIds.length === 0) redirect("/onboarding");
    const { data: workspace } = await supabase!.from("workspaces").select("id").in("organization_id", organizationIds).eq("status", "active").order("created_at").limit(1).maybeSingle();
    if (workspace?.id) redirect(`/app/${workspace.id}`);
    redirect("/onboarding");
  }
  redirect("/app/demo");
}
