"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function acceptOrganizationInvitationAction() {
  await requireUser("/auth/accept-invite");
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/auth/accept-invite?error=unavailable");
  const { data, error } = await supabase.rpc("accept_my_organization_invitations");
  if (error?.code === "42501") redirect("/auth/accept-invite?error=verification_required");
  if (error || !data || typeof data !== "object") redirect("/auth/accept-invite?error=unavailable");
  const result = data as Record<string, unknown>;
  if (Number(result.accepted) < 1) redirect("/auth/accept-invite?status=none");
  const workspaceId = typeof result.workspaceId === "string" ? result.workspaceId : null;
  redirect(workspaceId ? `/app/${workspaceId}` : "/app/workspaces?invitation=accepted");
}
