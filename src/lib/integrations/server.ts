import "server-only";

import type { AppUser } from "@/lib/auth/access";
import { connectionStates } from "@/lib/integrations/catalog";
import type { IntegrationProvider, StoredIntegrationConnection } from "@/lib/integrations/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function getIntegrationConnectionStates(
  user: AppUser,
  organizationId: string,
  workspaceId?: string,
) {
  if (user.source !== "supabase") return { mode: "demo" as const, connections: connectionStates() };
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { mode: "unavailable" as const, connections: connectionStates() };
  let query = supabase
    .from("integrations")
    .select("provider,status,connected_at,last_synced_at,last_error_code")
    .eq("organization_id", organizationId);
  query = workspaceId ? query.eq("workspace_id", workspaceId) : query.is("workspace_id", null);
  const { data, error } = await query;
  if (error) return { mode: "unavailable" as const, connections: connectionStates() };
  return {
    mode: "live" as const,
    connections: connectionStates((data || []) as Array<StoredIntegrationConnection & { provider: IntegrationProvider }>),
  };
}
