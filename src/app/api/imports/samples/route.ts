import { NextResponse } from "next/server";
import { z } from "zod";
import { previewBundledSample, readBundledSample } from "@/lib/imports/sample-data";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  kind: z.enum(["invoice", "payment"]),
  workspaceId: z.string().trim().min(1).max(80).optional(),
}).strict();
const workspaceIdSchema = z.string().uuid();

async function recentSavedMappings(workspaceId: string, kind: "invoice" | "payment") {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" as const };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    logServerError(authError, { operation: "import_sample_auth", code: authError.code });
    return { status: "unavailable" as const };
  }
  if (!authData.user) return { status: "unauthenticated" as const };

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) {
    logServerError(workspaceError, { operation: "import_sample_workspace", code: workspaceError.code });
    return { status: "unavailable" as const };
  }
  if (!workspace) return { status: "forbidden" as const };

  const { data, error } = await supabase
    .from("imports")
    .select("column_mapping")
    .eq("workspace_id", workspaceId)
    .eq("import_type", kind === "invoice" ? "invoices" : "payments")
    .in("status", ["completed", "completed_with_errors"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    logServerError(error, { operation: "import_sample_saved_mapping", code: error.code });
    return { status: "unavailable" as const };
  }
  return {
    status: "ready" as const,
    mappings: Array.isArray(data) ? data.map((row) => row.column_mapping) : [],
  };
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 4_000) {
    return NextResponse.json({ error: "The sample request is too large." }, { status: 413 });
  }

  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "import-sample"),
    prefix: "import-sample",
    limit: 30,
    windowSeconds: 300,
    failClosed: false,
  });
  if (!limit.allowed) {
    return NextResponse.json({
      error: "Too many sample imports. Wait a few minutes and try again.",
    }, { status: 429, headers: rateLimitHeaders(limit) });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose invoice or payment sample data." }, { status: 400, headers: rateLimitHeaders(limit) });
  }

  const requestedWorkspaceId = parsed.data.workspaceId || "demo";
  if (requestedWorkspaceId !== "demo" && !workspaceIdSchema.safeParse(requestedWorkspaceId).success) {
    return NextResponse.json({ error: "Choose a valid workspace before loading sample data." }, { status: 400, headers: rateLimitHeaders(limit) });
  }

  const savedMappingResult = requestedWorkspaceId !== "demo"
    ? await recentSavedMappings(requestedWorkspaceId, parsed.data.kind)
    : { status: "ready" as const, mappings: [] };
  if (savedMappingResult.status === "unauthenticated") {
    return NextResponse.json({ error: "Sign in before loading sample data for this workspace." }, { status: 401, headers: rateLimitHeaders(limit) });
  }
  if (savedMappingResult.status === "forbidden") {
    return NextResponse.json({ error: "You do not have access to load sample data for this workspace." }, { status: 403, headers: rateLimitHeaders(limit) });
  }
  if (savedMappingResult.status === "unavailable") {
    return NextResponse.json({ error: "Saved workspace mappings are temporarily unavailable. No sample was loaded." }, { status: 503, headers: rateLimitHeaders(limit) });
  }

  try {
    const sample = await readBundledSample(parsed.data.kind);
    return NextResponse.json(previewBundledSample(sample, savedMappingResult.mappings), {
      headers: rateLimitHeaders(limit),
    });
  } catch (error) {
    logServerError(error, { operation: "import_sample_preview" });
    return NextResponse.json({ error: "The sample could not be loaded." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
}
