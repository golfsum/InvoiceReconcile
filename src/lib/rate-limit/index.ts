import "server-only";

import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type RateLimitOptions = {
  key: string;
  limit: number;
  prefix: string;
  windowSeconds: number;
  failClosed?: boolean;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  source: "memory" | "upstash" | "unavailable";
};

type MemoryBucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, MemoryBucket>();
const upstashLimiters = new Map<string, Ratelimit>();
const MAX_MEMORY_BUCKETS = 5_000;

function hasUpstashConfiguration() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function getUpstashLimiter(options: RateLimitOptions) {
  const cacheKey = `${options.prefix}:${options.limit}:${options.windowSeconds}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(options.limit, `${options.windowSeconds} s`),
    prefix: `invoicereconcile:${options.prefix}`,
    analytics: false,
  });
  upstashLimiters.set(cacheKey, limiter);
  return limiter;
}

function pruneMemoryBuckets(now: number) {
  if (memoryBuckets.size < MAX_MEMORY_BUCKETS) return;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
  if (memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
    const oldestKey = memoryBuckets.keys().next().value as string | undefined;
    if (oldestKey) memoryBuckets.delete(oldestKey);
  }
}

function checkMemoryLimit(options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  pruneMemoryBuckets(now);
  const bucketKey = `${options.prefix}:${options.key}`;
  const existing = memoryBuckets.get(bucketKey);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + options.windowSeconds * 1_000 }
    : existing;
  bucket.count += 1;
  memoryBuckets.set(bucketKey, bucket);
  return {
    allowed: bucket.count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    resetAt: bucket.resetAt,
    source: "memory",
  };
}

export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  if (hasUpstashConfiguration()) {
    try {
      const result = await getUpstashLimiter(options).limit(options.key);
      return {
        allowed: result.success,
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.reset,
        source: "upstash",
      };
    } catch {
      const failClosed = options.failClosed ?? process.env.NODE_ENV === "production";
      if (failClosed) {
        return {
          allowed: false,
          limit: options.limit,
          remaining: 0,
          resetAt: Date.now() + options.windowSeconds * 1_000,
          source: "unavailable",
        };
      }
      return checkMemoryLimit(options);
    }
  }

  const failClosed = options.failClosed ?? process.env.NODE_ENV === "production";
  if (failClosed && process.env.NODE_ENV === "production") {
    return {
      allowed: false,
      limit: options.limit,
      remaining: 0,
      resetAt: Date.now() + options.windowSeconds * 1_000,
      source: "unavailable",
    };
  }
  return checkMemoryLimit(options);
}

function firstForwardedAddress(value: string | null) {
  return value?.split(",")[0]?.trim() || "unknown";
}

export function privacySafeRequestKey(request: Request, namespace: string) {
  const address = firstForwardedAddress(
    request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip"),
  );
  return createHash("sha256")
    .update(`${namespace}:${address}`)
    .digest("hex")
    .slice(0, 32);
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
  };
}

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const requestHost = firstForwardedAddress(
      request.headers.get("x-forwarded-host") || request.headers.get("host"),
    );
    const requestProtocol = firstForwardedAddress(request.headers.get("x-forwarded-proto"));
    const originUrl = new URL(origin);
    const expectedHost = requestHost === "unknown" ? requestUrl.host : requestHost;
    const expectedProtocol = requestProtocol === "unknown" ? requestUrl.protocol : `${requestProtocol}:`;
    return originUrl.host === expectedHost && originUrl.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

export function __resetMemoryRateLimitsForTests() {
  if (process.env.NODE_ENV === "production") return;
  memoryBuckets.clear();
}
