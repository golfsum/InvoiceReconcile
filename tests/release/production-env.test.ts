import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  formatProductionEnvironmentIssues,
  validateProductionEnvironment,
} from "@/lib/env/production";

const supabaseServiceRoleFixture = ["sb", "secret", "123456789012345678901234567890"].join("_");
const stripeLiveSecretFixture = ["sk", "live", "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_");
const stripeWebhookSecretFixture = ["whsec", "1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_");

function validEnvironment(): Record<string, string> {
  return {
    NEXT_PUBLIC_APP_URL: "https://invoicereconcile.com",
    NEXT_PUBLIC_SUPPORT_EMAIL: "support@invoicereconcile.com",
    NEXT_PUBLIC_LEGAL_NAME: "InvoiceReconcile, LLC",
    NEXT_PUBLIC_LEGAL_BUSINESS_ADDRESS: "123 Finance Avenue, Phoenix, AZ 85001",
    NEXT_PUBLIC_LEGAL_GOVERNING_LAW: "State of Arizona",
    NEXT_PUBLIC_LEGAL_COURT_VENUE: "State and federal courts in Maricopa County, Arizona",
    NEXT_PUBLIC_SUPABASE_URL: "https://invoice-reconcile.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_12345678901234567890",
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleFixture,
    UPSTASH_REDIS_REST_URL: "https://model-bison-12345.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash_token_1234567890",
    STRIPE_BILLING_MODE: "live",
    STRIPE_SECRET_KEY: stripeLiveSecretFixture,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecretFixture,
    STRIPE_PRICE_SOLO: "price_soloProduction123",
    STRIPE_PRICE_BUSINESS: "price_businessProduction123",
    STRIPE_PRICE_BOOKKEEPER: "price_bookkeeperProduction123",
    POSTMARK_SERVER_TOKEN: "postmark-server-token-123",
    POSTMARK_FROM_EMAIL: "support@invoicereconcile.com",
    POSTMARK_MESSAGE_STREAM: "outbound",
    ENABLE_DEMO_MODE: "false",
    DEMO_SESSION_SECRET: "",
    NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED: "true",
    NEXT_PUBLIC_FIRST_PARTY_ANALYTICS_ENABLED: "true",
    NEXT_PUBLIC_GA_ID: "G-ABCDEF1234",
  };
}

describe("production environment validation", () => {
  it("reports malformed URLs instead of throwing or echoing their contents", () => {
    const environment = { ...validEnvironment(), NEXT_PUBLIC_APP_URL: "private-invalid-value", UPSTASH_REDIS_REST_URL: "" };
    const result = validateProductionEnvironment(environment);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatProductionEnvironmentIssues(result.error.issues).join(" ")).not.toContain("private-invalid-value");
  });
  it("accepts a complete production environment", () => {
    expect(validateProductionEnvironment(validEnvironment()).success).toBe(true);
  });

  it("accepts the separate notifications sender and contact inbox", () => {
    expect(validateProductionEnvironment({ ...validEnvironment(), POSTMARK_FROM_EMAIL: "notifications@invoicereconcile.com", CONTACT_NOTIFICATION_EMAIL: "contact@invoicereconcile.com" }).success).toBe(true);
  });

  it("reports missing release services by variable name without echoing values", () => {
    const environment = validEnvironment();
    delete environment.UPSTASH_REDIS_REST_TOKEN;
    environment.STRIPE_SECRET_KEY = "sk_test_do_not_echo_this";
    const result = validateProductionEnvironment(environment);
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = formatProductionEnvironmentIssues(result.error.issues).join("\n");
    expect(messages).toContain("UPSTASH_REDIS_REST_TOKEN");
    expect(messages).toContain("STRIPE_SECRET_KEY");
    expect(messages).not.toContain("sk_test_do_not_echo_this");
  });

  it("requires a strong demo secret only when the production demo is enabled", () => {
    const disabled = validEnvironment();
    disabled.DEMO_SESSION_SECRET = "";
    expect(validateProductionEnvironment(disabled).success).toBe(true);

    const enabled = { ...disabled, ENABLE_DEMO_MODE: "true" };
    const result = validateProductionEnvironment(enabled);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === "DEMO_SESSION_SECRET")).toBe(true);
  });

  it("rejects ambiguous billing and analytics configuration", () => {
    const environment = validEnvironment();
    environment.STRIPE_PRICE_BUSINESS = environment.STRIPE_PRICE_SOLO;
    environment.NEXT_PUBLIC_GA_ID = "UA-legacy-id";
    const result = validateProductionEnvironment(environment);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(["STRIPE_PRICE_SOLO", "NEXT_PUBLIC_GA_ID"]),
    );
  });

  it("keeps the public and transactional support address consistent", () => {
    const publicMismatch = validEnvironment();
    publicMismatch.NEXT_PUBLIC_SUPPORT_EMAIL = "help@example.com";
    expect(validateProductionEnvironment(publicMismatch).success).toBe(false);

    const senderMismatch = validEnvironment();
    senderMismatch.POSTMARK_FROM_EMAIL = "notifications@example.com";
    expect(validateProductionEnvironment(senderMismatch).success).toBe(false);
  });
});
