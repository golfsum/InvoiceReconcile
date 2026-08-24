import { NextResponse } from "next/server";
import { analyticsEventSchema, isLikelyAutomatedUserAgent } from "@/lib/analytics";
import { storeAnalyticsEvent } from "@/lib/analytics/store";
import { analyticsPathTemplate } from "@/lib/analytics/paths";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  privacySafeRequestKey,
  rateLimitHeaders,
  verifySameOrigin,
} from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 16_384) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }
  const ipKey = privacySafeRequestKey(request, "analytics");
  const ipLimit = await checkRateLimit({
    key: ipKey,
    prefix: "analytics-ip",
    limit: 60,
    windowSeconds: 60,
  });
  if (!ipLimit.allowed) {
    const status = ipLimit.source === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: status === 503 ? "Analytics unavailable" : "Too many events" }, {
      status,
      headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(ipLimit) },
    });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const parsed = analyticsEventSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid analytics event" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const safePath = parsed.data.path ? analyticsPathTemplate(parsed.data.path) : undefined;

  if (isLikelyAutomatedUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ accepted: true, ignored: true }, { status: 202, headers: NO_STORE_HEADERS });
  }

  const limit = await checkRateLimit({
    key: `${parsed.data.anonymousId}:${parsed.data.sessionId}`,
    prefix: "analytics-visitor",
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    const status = limit.source === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: status === 503 ? "Analytics unavailable" : "Too many events" }, {
      status,
      headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(limit) },
    });
  }

  const duplicateLimit = await checkRateLimit({
    key: `${parsed.data.anonymousId}:${parsed.data.eventName}:${safePath || "no-path"}`,
    prefix: "analytics-dedupe",
    limit: 1,
    windowSeconds: 2,
  });
  if (!duplicateLimit.allowed) {
    if (duplicateLimit.source === "unavailable") {
      return NextResponse.json({ error: "Analytics unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ accepted: true, duplicate: true }, {
      status: 202,
      headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(limit) },
    });
  }

  const userClient = await getSupabaseServerClient();
  const serviceClient = getSupabaseServiceClient();
  if (!serviceClient) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ accepted: true, mode: "demo" }, {
        status: 202,
        headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(limit) },
      });
    }
    return NextResponse.json({ error: "Analytics unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  const { data } = userClient ? await userClient.auth.getUser() : { data: { user: null } };
  const routeScopedEvent = {
    ...parsed.data,
    organizationId: undefined,
    workspaceId: undefined,
    path: safePath,
  };
  const result = await storeAnalyticsEvent(serviceClient, routeScopedEvent, data.user?.id || null);
  if (!result.ok) {
    logger.error({ code: result.code, eventName: parsed.data.eventName }, "Analytics event storage failed");
    return NextResponse.json({ error: "Analytics unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json({ accepted: true, duplicate: result.duplicate || false }, {
    status: 202,
    headers: { ...NO_STORE_HEADERS, ...rateLimitHeaders(limit) },
  });
}
