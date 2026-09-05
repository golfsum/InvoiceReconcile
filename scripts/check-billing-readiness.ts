import Stripe from "stripe";
import { ServerClient } from "postmark";
import { createClient } from "@supabase/supabase-js";
import { BILLING_PLANS, configuredPriceId, validateStripePrice, type PaidPlanKey } from "../src/lib/billing/catalog";
import { stripeBillingMode } from "../src/lib/billing/mode";
import { validateProductionEnvironment, formatProductionEnvironmentIssues } from "../src/lib/env/production";

// Read-only. Inherit explicitly supplied environment variables; never silently
// load a local .env file that may point at an obsolete database or Stripe account.
type Check = { name: string; passed: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, passed: boolean, detail?: string) { checks.push({ name, passed, ...(detail ? { detail } : {}) }); }
async function inspect(name: string, action: () => Promise<void>) {
  try { await action(); } catch {
    // Provider errors can contain customer details or request credentials.
    check(name, false, "Provider read failed. Check access and configuration; no changes were made.");
  }
}

async function main() {
  const environment = validateProductionEnvironment(process.env);
  check("production_environment", environment.success,
    environment.success ? undefined : formatProductionEnvironmentIssues(environment.error.issues).join("; "));
  const mode = stripeBillingMode();
  check("live_mode", mode === "live", mode || "Invalid or missing Stripe configuration");
  const stripe = mode ? new Stripe(process.env.STRIPE_SECRET_KEY!.trim(), { maxNetworkRetries: 1, timeout: 15000 }) : null;
  if (stripe) {
    await inspect("stripe_account_read", async () => {
      const account = await stripe.accounts.retrieve(null);
      check("charges_enabled", account.charges_enabled);
      check("payouts_enabled", account.payouts_enabled);
      check("account_requirements", !account.requirements?.disabled_reason && !account.requirements?.currently_due?.length);
    });
    for (const plan of Object.keys(BILLING_PLANS) as PaidPlanKey[]) {
      await inspect(`price_${plan}_read`, async () => {
        const id = configuredPriceId(plan);
        if (!id) { check(`price_${plan}`, false, "Price ID missing"); return; }
        const price = await stripe.prices.retrieve(id);
        const validation = validateStripePrice(plan, {
          id, active: price.active, currency: price.currency, unitAmount: price.unit_amount,
          recurring: price.recurring ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null,
        });
        check(`price_${plan}`, validation.valid && price.livemode === (mode === "live"), validation.valid ? undefined : validation.reason);
      });
    }
    await inspect("webhook_read", async () => {
      const url = new URL("/api/webhooks/stripe", process.env.NEXT_PUBLIC_APP_URL).toString();
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 }).autoPagingToArray({ limit: 1000 });
      const required = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
      const matching = endpoints.filter((endpoint) => endpoint.url === url && endpoint.status === "enabled" && endpoint.livemode === (mode === "live"));
      check("webhook_events", matching.some((endpoint) => required.every((event) => endpoint.enabled_events.includes("*") || endpoint.enabled_events.includes(event))));
      check("webhook_api_version", matching.some((endpoint) => endpoint.api_version === Stripe.API_VERSION), `Expected pinned version ${Stripe.API_VERSION}`);
    });
    await inspect("portal_read", async () => {
      const { data } = await stripe.billingPortal.configurations.list({ active: true, is_default: true, limit: 1 });
      const portal = data[0] ? await stripe.billingPortal.configurations.retrieve(data[0].id, {
        expand: ["features.subscription_update.products"],
      }) : undefined;
      check("portal_default", Boolean(portal && portal.livemode === (mode === "live")));
      check("portal_cancel", Boolean(portal?.features.subscription_cancel.enabled && portal.features.subscription_cancel.mode === "at_period_end"));
      check("portal_payment_recovery", Boolean(portal?.features.payment_method_update.enabled && portal.features.invoice_history.enabled));
      const update = portal?.features.subscription_update;
      const prices = update?.products?.flatMap((product) => product.prices) || [];
      check("portal_plan_changes", Boolean(update?.enabled && update.default_allowed_updates.includes("price")
        && Object.keys(BILLING_PLANS).every((plan) => prices.includes(configuredPriceId(plan as PaidPlanKey) || ""))));
    });
  } else {
    check("stripe_inspection", false, "Supply matching Stripe keys before running provider checks");
  }

  const projectRef = process.argv.find((arg) => arg.startsWith("--project-ref="))?.split("=")[1];
  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const expectedDatabase = Boolean(projectRef && /^[a-z0-9]+$/.test(projectRef)
    && databaseUrl === `https://${projectRef}.supabase.co`);
  check("database_target", expectedDatabase, "Pass --project-ref with the intended production project; local environment files are not loaded automatically");
  if (expectedDatabase && process.env.SUPABASE_SERVICE_ROLE_KEY && stripe) {
    await inspect("billing_records_read", async () => {
      const database = createClient(databaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      let incompatible = 0;
      let scanned = 0;
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await database.from("subscriptions")
          .select("id,status,provider_customer_id,provider_subscription_id").order("id").range(offset, offset + 99);
        if (error || !data) throw new Error("Billing read failed");
        for (const row of data) {
          scanned += 1;
          try {
            const customer = row.provider_customer_id ? await stripe.customers.retrieve(row.provider_customer_id) : null;
            const subscription = row.provider_subscription_id ? await stripe.subscriptions.retrieve(row.provider_subscription_id) : null;
            const missingPaidIdentity = ["active", "trialing", "past_due"].includes(row.status) && (!customer || !subscription);
            if (missingPaidIdentity || (customer && (customer.deleted || customer.livemode !== (mode === "live")))
                || (subscription && subscription.livemode !== (mode === "live"))) incompatible += 1;
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "resource_missing") incompatible += 1;
            else throw error;
          }
        }
        if (data.length < 100) break;
        if (offset >= 9900) throw new Error("Audit limit reached; continue the audit before launch");
      }
      check("billing_records_compatible", incompatible === 0, `${scanned} records inspected; ${incompatible} require migration. No records changed.`);
      const { data: intents, error } = await database.from("stripe_checkout_intents")
        .select("id,provider_session_id", { count: "exact" }).in("status", ["creating", "ready"]);
      if (error || !intents) throw new Error("Checkout read failed");
      // Freeze checkout before cutover and let all in-flight sessions expire.
      check("checkout_cutover_drained", intents.length === 0, "No creating or ready Checkout intents may remain during cutover");
    });
  } else check("billing_records_compatible", false, "Database compatibility has not been verified");

  if (process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_MESSAGE_STREAM) {
    await inspect("postmark_stream_read", async () => {
      const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);
      const stream = await client.getMessageStream(process.env.POSTMARK_MESSAGE_STREAM!);
      check("postmark_transactional_stream", stream.MessageStreamType === "Transactional" && !stream.ArchivedAt);
    });
  } else check("postmark_transactional_stream", false, "Postmark token and stream must be configured");

  const manualGates = [
    "Verify signup confirmation and password reset using a real inbox. Supabase SMTP is separate from application Postmark configuration.",
    "Verify a delivered application email and reply access to support@invoicereconcile.com.",
    "Confirm previews use a separate sandbox database, Stripe keys, prices and webhook endpoint.",
    "Exercise renewal failure, access downgrade and payment recovery against the deployed sandbox and inspect persisted entitlements.",
    "Verify the live endpoint signing secret with a Stripe-delivered event. Listing endpoints cannot validate the saved signing secret.",
    "After explicit approval, perform and inspect a real paid checkout, feature unlock, portal change and cancellation. This script never charges a card.",
  ];
  const automatedChecksPassed = checks.every((item) => item.passed);
  process.stdout.write(`${JSON.stringify({ automatedChecksPassed, liveLaunchApproved: false, checks, manualGates }, null, 2)}\n`);
  if (!automatedChecksPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const location = error instanceof Error ? error.stack?.split("\n").find((line) => line.includes("check-billing-readiness.ts:")) : undefined;
  process.stderr.write(`Billing readiness inspection failed; no changes were made.${location ? `\n${location}` : ""}\n`);
  process.exitCode = 1;
});
