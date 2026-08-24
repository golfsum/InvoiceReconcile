import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sendContactEmails } from "@/lib/email";
import { analyticsPathTemplate } from "@/lib/analytics/paths";
import { logger, logServerError } from "@/lib/logger";
import {
  checkRateLimit,
  privacySafeRequestKey,
  rateLimitHeaders,
  verifySameOrigin,
} from "@/lib/rate-limit";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const pathSchema = z.string().trim().max(500).refine(
  (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("?"),
);
const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(10).max(10_000),
  sourcePath: pathSchema.optional(),
  companyWebsite: z.string().max(0).optional(),
}).strict();

function anonymousValueKey(namespace: string, value: string) {
  return createHash("sha256").update(`${namespace}:${value.toLowerCase()}`).digest("hex").slice(0, 32);
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 24_000) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 });
  }
  const ipLimit = await checkRateLimit({
    key: privacySafeRequestKey(request, "contact"),
    prefix: "contact-ip",
    limit: 5,
    windowSeconds: 3_600,
  });
  if (!ipLimit.allowed) {
    const status = ipLimit.source === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: status === 503 ? "Contact service is temporarily unavailable" : "Too many messages" }, {
      status,
      headers: rateLimitHeaders(ipLimit),
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof payload === "object" && payload && "companyWebsite" in payload && payload.companyWebsite) {
    return NextResponse.json({ accepted: true }, { status: 202 });
  }
  const parsed = contactSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Check the contact form fields" }, { status: 400 });

  const emailLimit = await checkRateLimit({
    key: anonymousValueKey("contact-email", parsed.data.email),
    prefix: "contact-email",
    limit: 3,
    windowSeconds: 3_600,
  });
  if (!emailLimit.allowed) {
    const status = emailLimit.source === "unavailable" ? 503 : 429;
    return NextResponse.json({ error: status === 503 ? "Contact service is temporarily unavailable" : "Too many messages" }, {
      status,
      headers: rateLimitHeaders(emailLimit),
    });
  }

  const requestId = randomUUID();
  const minimizedContact = {
    ...parsed.data,
    sourcePath: parsed.data.sourcePath
      ? analyticsPathTemplate(parsed.data.sourcePath)
      : undefined,
  };
  let stored = false;
  let storedRequestId: string | null = null;
  const supabase = getSupabaseServiceClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("contact_requests")
      .insert({
        name: minimizedContact.name,
        email: minimizedContact.email,
        subject: minimizedContact.subject || null,
        message: minimizedContact.message,
        source_path: minimizedContact.sourcePath || null,
      })
      .select("id")
      .single();
    if (error) {
      logger.error({ code: error.code, requestId }, "Contact request storage failed");
    } else {
      stored = true;
      storedRequestId = typeof data?.id === "string" ? data.id : null;
    }
  }

  let notificationDelivered = false;
  let emailMode: "demo" | "postmark" | "unavailable" = "unavailable";
  try {
    const delivery = await sendContactEmails({ ...minimizedContact, requestId });
    notificationDelivered = delivery.notification.delivered;
    emailMode = delivery.notification.mode;
  } catch (error) {
    logServerError(error, { operation: "contact_email", requestId });
  }

  if (supabase && storedRequestId) {
    const deliveryStatus = emailMode === "demo" ? "demo" : notificationDelivered ? "delivered" : "failed";
    const { error } = await supabase
      .from("contact_requests")
      .update({
        delivery_status: deliveryStatus,
        delivery_attempts: 1,
        last_delivery_attempt_at: new Date().toISOString(),
        delivery_error_code: notificationDelivered || emailMode === "demo" ? null : "support_notification_failed",
      })
      .eq("id", storedRequestId);
    if (error) logger.error({ code: error.code, requestId }, "Contact delivery status update failed");
  }

  const localDemoAccepted = process.env.NODE_ENV !== "production" && emailMode === "demo";
  if (!stored && !notificationDelivered && !localDemoAccepted) {
    return NextResponse.json({ error: "Your message could not be delivered. Email support@invoicereconcile.com." }, { status: 503 });
  }
  logger.info({ requestId, stored, notificationDelivered, emailMode }, "Contact request accepted");
  return NextResponse.json({ accepted: true, reference: requestId }, {
    status: 202,
    headers: rateLimitHeaders(emailLimit),
  });
}
