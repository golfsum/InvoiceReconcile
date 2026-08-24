import { z } from "zod";

export const analyticsEventNameSchema = z.enum([
  "page_view",
  "demo_started",
  "demo_completed",
  "sample_demo_started",
  "pricing_viewed",
  "signup_started",
  "signup_completed",
  "import_started",
  "import_completed",
  "invoice_imported",
  "payment_imported",
  "review_opened",
  "exception_reviewed",
  "match_confirmed",
  "match_rejected",
  "reconciliation_completed",
  "export_created",
  "checkout_started",
  "checkout_completed",
  "subscription_started",
  "tool_used",
  "lump_sum_tool_used",
  "contact_submitted",
]);

export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

export const SAFE_ANALYTICS_PROPERTY_KEYS = [
  "audience",
  "confidence_band",
  "cta",
  "demo_scenario",
  "export_type",
  "file_type",
  "import_type",
  "match_method",
  "plan",
  "record_count_band",
  "result",
  "source",
  "tool",
  "workspace_count_band",
] as const;

export const safeAnalyticsPropertiesSchema = z.object({
  audience: z.enum(["accounting_firm", "bookkeeping_firm", "finance_team", "small_business", "unknown"]).optional(),
  confidence_band: z.enum(["high", "medium", "low"]).optional(),
  cta: z.enum(["header", "hero", "in_app", "pricing", "resource", "tool"]).optional(),
  demo_scenario: z.enum(["combined_payment", "fee_difference"]).optional(),
  export_type: z.enum(["all", "audit", "discrepancy", "reconciled", "unmatched"]).optional(),
  file_type: z.enum(["csv", "pdf", "sample", "xlsx"]).optional(),
  import_type: z.enum(["invoice", "payment"]).optional(),
  match_method: z.enum([
    "combined_payment",
    "exact_amount",
    "exact_reference",
    "fee_difference",
    "manual",
    "partial_payment",
    "unmatched",
  ]).optional(),
  plan: z.enum(["free", "solo", "business", "bookkeeper"]).optional(),
  record_count_band: z.enum(["1_50", "51_500", "501_2500", "2501_10000", "10000_plus"]).optional(),
  result: z.enum(["canceled", "completed", "confirmed", "error", "rejected", "success"]).optional(),
  source: z.enum(["direct", "email", "in_app", "organic_search", "paid_search", "referral", "sample"]).optional(),
  tool: z.enum(["csv_checker", "lump_sum_matcher", "partial_payment_calculator"]).optional(),
  workspace_count_band: z.enum(["1", "2_3", "4_20", "20_plus"]).optional(),
}).strict().default({});

const campaignValueSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/);

const safePathSchema = z.string().trim().max(500).refine(
  (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("?"),
  "Path must be a query-free application path",
);

export const analyticsEventSchema = z.object({
  eventId: z.string().uuid(),
  eventName: analyticsEventNameSchema,
  anonymousId: z.string().uuid(),
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  path: safePathSchema.optional(),
  referrer: z.string().url().max(1_000).optional(),
  utmSource: campaignValueSchema.optional(),
  utmMedium: campaignValueSchema.optional(),
  utmCampaign: campaignValueSchema.optional(),
  properties: safeAnalyticsPropertiesSchema,
}).strict().refine((value) => !value.workspaceId || Boolean(value.organizationId), {
  message: "A workspace event requires an organization",
  path: ["workspaceId"],
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;

export function referrerHost(referrer?: string) {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().slice(0, 253);
  } catch {
    return null;
  }
}

const AUTOMATED_USER_AGENT = /\b(bot|crawler|spider|headlesschrome|phantomjs|slurp|facebookexternalhit|preview)\b/i;

export function isLikelyAutomatedUserAgent(userAgent: string | null) {
  return Boolean(userAgent && AUTOMATED_USER_AGENT.test(userAgent));
}
