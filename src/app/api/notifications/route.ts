import { NextResponse } from "next/server";
import { z } from "zod";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ workspaceId: z.string().uuid() });
const markReadSchema = z.object({
  workspaceId: z.string().uuid(),
  notificationIds: z.array(z.string().uuid()).min(1).max(20),
});
const notificationSchema = z.object({
  id: z.string().uuid(),
  event_type: z.enum(["import_preview_ready", "import_failed", "reconciliation_ready", "reconciliation_failed"]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  action_path: z.string().regex(/^\/app\/[0-9a-f-]+\/(imports|exceptions)$/),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

async function authorize(request: Request, operation: string) {
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, operation),
    prefix: operation,
    limit: 120,
    windowSeconds: 300,
  });
  if (!limit.allowed) return { authorized: false, response: NextResponse.json(
    { error: limit.source === "unavailable" ? "Notifications are temporarily unavailable." : "Too many notification requests. Wait a moment and try again." },
    { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) },
  ) } as const;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { authorized: false, response: NextResponse.json({ error: "Notifications are not configured." }, { status: 503, headers: noStoreHeaders }) } as const;
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { authorized: false, response: NextResponse.json({ error: "Sign in to view notifications." }, { status: 401, headers: noStoreHeaders }) } as const;
  return { authorized: true, supabase, userId: authData.user.id, limit } as const;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "A valid workspace is required." }, { status: 400, headers: noStoreHeaders });
  const authorization = await authorize(request, "notifications-read");
  if (!authorization.authorized) return authorization.response;
  const { data, error } = await authorization.supabase
    .from("user_notifications")
    .select("id,event_type,title,body,action_path,read_at,created_at")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", authorization.userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    logServerError(error, { operation: "notifications_read", code: error.code });
    return NextResponse.json({ error: error.code === "42501" ? "You do not have access to these notifications." : "Notifications are temporarily unavailable." }, { status: error.code === "42501" ? 403 : 503, headers: noStoreHeaders });
  }
  const notifications = z.array(notificationSchema).safeParse(data || []);
  if (!notifications.success) {
    logServerError(new Error("Notification query returned invalid data"), { operation: "notifications_read" });
    return NextResponse.json({ error: "Notifications are temporarily unavailable." }, { status: 503, headers: noStoreHeaders });
  }
  return NextResponse.json({ notifications: notifications.data }, { headers: { ...noStoreHeaders, ...rateLimitHeaders(authorization.limit) } });
}

export async function PATCH(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid notification request." }, { status: 400, headers: noStoreHeaders });
  }
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose valid notifications." }, { status: 400, headers: noStoreHeaders });
  const authorization = await authorize(request, "notifications-write");
  if (!authorization.authorized) return authorization.response;
  const { error } = await authorization.supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", authorization.userId)
    .in("id", parsed.data.notificationIds);
  if (error) {
    logServerError(error, { operation: "notifications_mark_read", code: error.code });
    return NextResponse.json({ error: error.code === "42501" ? "You do not have access to these notifications." : "Notifications could not be updated." }, { status: error.code === "42501" ? 403 : 503, headers: noStoreHeaders });
  }
  return NextResponse.json({ updated: true }, { headers: { ...noStoreHeaders, ...rateLimitHeaders(authorization.limit) } });
}
