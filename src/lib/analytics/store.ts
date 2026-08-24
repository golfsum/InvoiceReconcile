import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsEventInput } from "@/lib/analytics/events";
import { referrerHost } from "@/lib/analytics/events";

export async function storeAnalyticsEvent(
  supabase: SupabaseClient,
  input: AnalyticsEventInput,
  userId: string | null,
) {
  const { error } = await supabase.from("analytics_events").insert({
    event_id: input.eventId,
    event_name: input.eventName,
    anonymous_id: input.anonymousId,
    session_id: input.sessionId,
    user_id: userId,
    organization_id: userId ? input.organizationId || null : null,
    workspace_id: userId ? input.workspaceId || null : null,
    path: input.path || null,
    referrer_host: referrerHost(input.referrer),
    utm_source: input.utmSource || null,
    utm_medium: input.utmMedium || null,
    utm_campaign: input.utmCampaign || null,
    properties: input.properties,
  });
  if (!error) return { ok: true as const };
  if (error.code === "23505") return { ok: true as const, duplicate: true as const };
  return { ok: false as const, code: "analytics_insert_failed" };
}
