import { NextResponse } from "next/server";
import { z } from "zod";
import { loadLatestReconciliationRun } from "@/lib/reconciliation/live";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ workspaceId: z.string().uuid() });
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "A valid workspace is required." }, { status: 400, headers: noStoreHeaders });

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Durable storage is not configured." }, { status: 503, headers: noStoreHeaders });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return NextResponse.json({ error: "Sign in to load saved reconciliation runs." }, { status: 401, headers: noStoreHeaders });

  const result = await loadLatestReconciliationRun(parsed.data.workspaceId);
  if (result.status === "unavailable") return NextResponse.json({ error: "Saved reconciliation data is temporarily unavailable." }, { status: 503, headers: noStoreHeaders });
  if (result.status === "empty") return NextResponse.json({ error: "No saved reconciliation run was found." }, { status: 404, headers: noStoreHeaders });
  return NextResponse.json(result.data, { headers: noStoreHeaders });
}
