import "server-only";

import pino from "pino";

const REDACTED_PATHS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "apiKey",
  "email",
  "name",
  "message",
  "body",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.clientSecret",
  "*.apiKey",
  "*.email",
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: {
    service: "web",
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  },
  redact: {
    paths: REDACTED_PATHS,
    censor: "[redacted]",
  },
  serializers: {
    err: () => ({ type: "Error", message: "[redacted]", stack: "[redacted]" }),
  },
});

export type SafeLogContext = Record<string, boolean | number | string | null | undefined>;

const SAFE_CONTEXT_KEYS = new Set(["operation", "code", "eventId", "eventType", "requestId", "plan"]);
const SAFE_CONTEXT_VALUE = /^[a-z0-9_.:-]{1,128}$/i;

export function sanitizeLogContext(context: SafeLogContext): SafeLogContext {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => SAFE_CONTEXT_KEYS.has(key))
      .map(([key, value]) => {
        if (typeof value === "string") return [key, SAFE_CONTEXT_VALUE.test(value) ? value : "[redacted]"];
        return [key, value];
      }),
  );
}

export function logServerError(error: unknown, context: SafeLogContext) {
  logger.error(
    { ...sanitizeLogContext(context), failureType: error instanceof Error ? "error" : "unknown" },
    "server_operation_failed",
  );
}
