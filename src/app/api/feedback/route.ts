import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/access";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  priorWorkflow: z.enum(["quickbooks_manually", "excel", "google_sheets", "xero_manually", "accountant_bookkeeper", "other"]),
  workspaceId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "feedback"), prefix: "feedback", limit: 10, windowSeconds: 3600 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Feedback is temporarily unavailable." : "Too many feedback attempts." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose one workflow." }, { status: 400 });
  const user = await getCurrentUser();
  const supabase = await getSupabaseServerClient();
  if (user?.source === "supabase" && supabase) {
    let workspace: { id: string; organization_id: string } | null = null;
    if (parsed.data.workspaceId) {
      const result = await supabase
        .from("workspaces")
        .select("id,organization_id")
        .eq("id", parsed.data.workspaceId)
        .maybeSingle();
      if (result.error) return NextResponse.json({ error: "Feedback workspace could not be verified." }, { status: 503 });
      if (!result.data) return NextResponse.json({ error: "Workspace access is required." }, { status: 403 });
      workspace = result.data;
    }

    const serviceClient = getSupabaseServiceClient();
    if (!serviceClient) return NextResponse.json({ error: "Feedback is temporarily unavailable." }, { status: 503 });
    const { error } = await serviceClient.from("feedback").insert({
      user_id: user.id,
      organization_id: workspace?.organization_id || null,
      workspace_id: workspace?.id || null,
      feedback_type: "general",
      message: `Prior workflow: ${parsed.data.priorWorkflow}`,
      page_path: workspace?.id ? `/app/${workspace.id}/exceptions` : "/app/demo/exceptions",
      status: "new",
    });
    if (error) return NextResponse.json({ error: "Feedback could not be saved." }, { status: 503 });
    return NextResponse.json({ accepted: true }, { status: 202, headers: rateLimitHeaders(limit) });
  }
  if (process.env.NODE_ENV !== "production") return NextResponse.json({ accepted: true, mode: "demo" }, { status: 202, headers: rateLimitHeaders(limit) });
  return NextResponse.json({ error: "Sign in to save feedback." }, { status: 401 });
}
