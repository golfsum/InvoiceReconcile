import "server-only";

import { z } from "zod";

const explicitBoolean = z.enum(["true", "false"], {
  error: "must be explicitly set to true or false",
});

const requiredText = (minimum = 1) => z.string().trim().min(minimum, "is required");
const nonPlaceholderText = (minimum = 2) => requiredText(minimum).refine(
  (value) => !/^(?:tbd|todo|unknown|n\/a|none|changeme|replace(?:[-_ ]?me)?|your[-_ ].*|<.*>)$/i.test(value),
  "must be replaced with the production operator value",
);
const email = z.string().trim().email("must be a valid email address");
const supportEmail = email.refine(
  (value) => value.toLowerCase() === "support@invoicereconcile.com",
  "must be support@invoicereconcile.com",
);
const httpsUrl = z.string().trim().url("must be a valid URL").refine(
  (value) => URL.canParse(value) && new URL(value).protocol === "https:",
  "must use HTTPS",
);
const optionalTrimmed = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().optional(),
);

export const productionEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_URL: httpsUrl.refine((value) => {
    if (!URL.canParse(value)) return false;
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname !== "localhost" && hostname !== "127.0.0.1" && !hostname.endsWith(".local");
  }, "must use a public production hostname"),
  NEXT_PUBLIC_SUPPORT_EMAIL: supportEmail,

  NEXT_PUBLIC_LEGAL_NAME: nonPlaceholderText(),
  NEXT_PUBLIC_LEGAL_BUSINESS_ADDRESS: nonPlaceholderText(8),
  NEXT_PUBLIC_LEGAL_GOVERNING_LAW: nonPlaceholderText(3),
  NEXT_PUBLIC_LEGAL_COURT_VENUE: nonPlaceholderText(3),

  NEXT_PUBLIC_SUPABASE_URL: httpsUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredText(20),
  SUPABASE_SERVICE_ROLE_KEY: requiredText(30),

  UPSTASH_REDIS_REST_URL: httpsUrl,
  UPSTASH_REDIS_REST_TOKEN: requiredText(10),

  STRIPE_BILLING_MODE: z.literal("live", { error: "must be explicitly set to live for a paid launch" }),
  STRIPE_SECRET_KEY: z.string().trim().regex(/^sk_live_[A-Za-z0-9]+$/, "must be a live Stripe secret key"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().trim().regex(/^pk_live_[A-Za-z0-9]+$/, "must be a live Stripe publishable key"),
  STRIPE_WEBHOOK_SECRET: z.string().trim().regex(/^whsec_[A-Za-z0-9]+$/, "must be a Stripe webhook signing secret"),
  STRIPE_PRICE_SOLO: z.string().trim().regex(/^price_[A-Za-z0-9]+$/, "must be a Stripe Price ID"),
  STRIPE_PRICE_BUSINESS: z.string().trim().regex(/^price_[A-Za-z0-9]+$/, "must be a Stripe Price ID"),
  STRIPE_PRICE_BOOKKEEPER: z.string().trim().regex(/^price_[A-Za-z0-9]+$/, "must be a Stripe Price ID"),

  POSTMARK_SERVER_TOKEN: nonPlaceholderText(10),
  POSTMARK_FROM_EMAIL: email.refine(
    (value) => ["notifications@invoicereconcile.com", "support@invoicereconcile.com"].includes(value.toLowerCase()),
    "must use the verified InvoiceReconcile notifications or support sender",
  ),
  CONTACT_NOTIFICATION_EMAIL: email.optional(),
  POSTMARK_MESSAGE_STREAM: nonPlaceholderText(),

  ENABLE_DEMO_MODE: explicitBoolean,
  DEMO_SESSION_SECRET: optionalTrimmed,

  NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED: explicitBoolean,
  NEXT_PUBLIC_FIRST_PARTY_ANALYTICS_ENABLED: explicitBoolean,
  NEXT_PUBLIC_GA_ID: optionalTrimmed,
}).superRefine((environment, context) => {
  if (environment.NEXT_PUBLIC_SUPABASE_ANON_KEY === environment.SUPABASE_SERVICE_ROLE_KEY) {
    context.addIssue({
      code: "custom",
      path: ["SUPABASE_SERVICE_ROLE_KEY"],
      message: "must be distinct from the public anonymous key",
    });
  }

  const priceIds = [
    environment.STRIPE_PRICE_SOLO,
    environment.STRIPE_PRICE_BUSINESS,
    environment.STRIPE_PRICE_BOOKKEEPER,
  ];
  if (new Set(priceIds).size !== priceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["STRIPE_PRICE_SOLO"],
      message: "the three plan Price IDs must be distinct",
    });
  }

  if (environment.ENABLE_DEMO_MODE === "true") {
    const secret = environment.DEMO_SESSION_SECRET?.trim() || "";
    if (secret.length < 32 || /^(?:changeme|replace|demo|secret)/i.test(secret)) {
      context.addIssue({
        code: "custom",
        path: ["DEMO_SESSION_SECRET"],
        message: "must be a non-placeholder secret of at least 32 characters when the production demo is enabled",
      });
    }
  }

  if (environment.NEXT_PUBLIC_GA_ID && !/^G-[A-Z0-9]{6,20}$/.test(environment.NEXT_PUBLIC_GA_ID)) {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_GA_ID"],
      message: "must be a GA4 measurement ID such as G-XXXXXXXXXX",
    });
  }
});

export type ProductionEnvironment = z.infer<typeof productionEnvironmentSchema>;

export function validateProductionEnvironment(environment: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return productionEnvironmentSchema.safeParse(environment);
}

export function formatProductionEnvironmentIssues(issues: z.core.$ZodIssue[]) {
  return issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "environment";
    return `${field}: ${issue.message}`;
  });
}
