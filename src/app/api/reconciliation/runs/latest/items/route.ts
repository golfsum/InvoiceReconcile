import { NextResponse } from "next/server";
import { z } from "zod";
import { loadLatestReconciliationPage } from "@/lib/reconciliation/large-run";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  type: z.enum(["invoice", "payment", "match"]),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).default(""),
  status: z.string().trim().max(30).default("all"),
});
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid saved-run page." }, { status: 400, headers: noStoreHeaders });
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "large-run-page"),
    prefix: "large-run-page",
    limit: 180,
    windowSeconds: 300,
  });
  if (!limit.allowed) return NextResponse.json({
    error: limit.source === "unavailable" ? "Saved-run paging is temporarily unavailable." : "Too many saved-run page requests. Wait a moment and try again.",
  }, { status: limit.source === "unavailable" ? 503 : 429, headers: { ...noStoreHeaders, ...rateLimitHeaders(limit) } });
  const result = await loadLatestReconciliationPage({
    workspaceId: parsed.data.workspaceId,
    itemType: parsed.data.type,
    offset: parsed.data.offset,
    limit: parsed.data.limit,
    search: parsed.data.search,
    status: parsed.data.status,
  });
  if (result.status === "unavailable") return NextResponse.json({ error: "Saved reconciliation records are temporarily unavailable." }, { status: 503, headers: noStoreHeaders });
  if (result.status === "empty") return NextResponse.json({ error: "No saved reconciliation run was found." }, { status: 404, headers: noStoreHeaders });
  if (result.status === "legacy") return NextResponse.json({ error: "This older saved run uses the legacy read path." }, { status: 409, headers: noStoreHeaders });
  return NextResponse.json(result.data, { headers: { ...noStoreHeaders, ...rateLimitHeaders(limit) } });
}
