import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230020_stripe_checkout_intents.sql"),
  "utf8",
);

describe("Stripe Checkout intent migration", () => {
  it("keeps one opaque active intent per organization without payment data or a checkout URL", () => {
    expect(migration).toContain("create table public.stripe_checkout_intents");
    expect(migration).toContain("create unique index stripe_checkout_intents_active_org_uidx");
    expect(migration).toContain("where status in ('creating', 'ready')");
    expect(migration).toContain("alter table public.stripe_checkout_intents force row level security");
    expect(migration).toContain("revoke all on table public.stripe_checkout_intents");
    expect(migration).not.toMatch(/checkout_url|card_|payment_method|billing_details|customer_email|raw_payload/i);
  });

  it("serializes reservation and rejects an existing non-canceled subscription", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain(":stripe-billing");
    expect(migration).toContain("s.provider_subscription_id is not null");
    expect(migration).toContain("s.status <> 'canceled'");
    expect(migration).toContain("'code', 'existing_subscription'");
    expect(migration).toContain("m.role in ('owner', 'admin')");
    expect(migration).toContain("status', 'rejected'");
    expect(migration).toMatch(
      /select intent\.organization_id into v_organization_id[\s\S]*pg_catalog\.pg_advisory_xact_lock[\s\S]*select intent\.\* into v_intent[\s\S]*for update/,
    );
  });

  it("reclaims the same expired creation lease for crash-safe Stripe idempotency", () => {
    expect(migration).toContain("v_intent.lease_expires_at > v_now");
    expect(migration).toContain("lease_hash = app_private.stripe_checkout_lease_hash(v_token)");
    expect(migration).toContain("'recovered', true");
    expect(migration).toContain("created_at <= v_now - interval '40 minutes'");
  });

  it("confines session receipts and lifecycle changes to the service role", () => {
    expect(migration).toContain("if auth.role() is distinct from 'service_role'");
    expect(migration).toContain("complete_stripe_checkout_intent");
    expect(migration).toContain("expire_stripe_checkout_intent");
    expect(migration).toContain("mark_stripe_checkout_intent_completed");
    expect(migration).toContain("grant execute on function public.reserve_stripe_checkout_intent(uuid, text, text)\nto authenticated");
    expect(migration).toContain("grant execute on function public.complete_stripe_checkout_intent(uuid, text, text, timestamptz)\nto service_role");
  });
});
