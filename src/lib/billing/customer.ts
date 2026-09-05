import "server-only";
import type Stripe from "stripe";
import { stripeObjectMatchesMode } from "@/lib/billing/mode";

export const incompatibleBillingAccount = {
  code: "billing_account_migration_required",
  error: "Your billing account needs updating. Contact support@invoicereconcile.com before subscribing.",
};

export async function isCompatibleStripeCustomer(stripe: Stripe, customerId: string) {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return !customer.deleted && stripeObjectMatchesMode(customer);
  } catch (error) {
    // Missing objects usually mean a sandbox/live or Stripe-account mismatch.
    // Never silently replace them: that can create duplicate subscriptions.
    if (error && typeof error === "object" && "code" in error && error.code === "resource_missing") return false;
    throw error;
  }
}
