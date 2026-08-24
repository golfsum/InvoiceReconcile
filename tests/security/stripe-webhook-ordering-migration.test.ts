import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230018_stripe_webhook_event_ordering.sql"),
  "utf8",
);

describe("Stripe webhook ordering migration", () => {
  it("keeps a minimal service-role-only event ledger", () => {
    expect(migration).toContain("create table public.stripe_webhook_events");
    expect(migration).toContain("alter table public.stripe_webhook_events force row level security");
    expect(migration).toContain("revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role");
    expect(migration).toContain("if auth.role() is distinct from 'service_role'");
    expect(migration).toContain(") to service_role;");
    expect(migration).not.toMatch(/raw_payload|request_body|customer_email|metadata jsonb/i);
  });

  it("deduplicates before state mutation and commits the ledger with the subscription", () => {
    const ledgerInsert = migration.indexOf("insert into public.stripe_webhook_events (");
    const subscriptionWrite = migration.indexOf("insert into public.subscriptions (");
    const appliedOutcome = migration.indexOf("set outcome = 'applied', processed_at = now()");
    expect(ledgerInsert).toBeGreaterThan(-1);
    expect(migration).toContain("on conflict (event_id) do nothing");
    expect(migration).toContain("v_existing_event.outcome not in ('applied', 'stale')");
    expect(migration).toContain("'outcome', 'duplicate'");
    expect(subscriptionWrite).toBeGreaterThan(ledgerInsert);
    expect(appliedOutcome).toBeGreaterThan(subscriptionWrite);
  });

  it("serializes organization state and makes equal-second deletion deterministic", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("when 'customer.subscription.deleted' then 100");
    expect(migration).toContain("row(p_event_created_at, v_event_precedence, p_event_id)");
    expect(migration).toContain("<= row(");
    expect(migration).toContain("last_stripe_event_id");
  });

  it("does not let events from an obsolete subscription mutate its replacement", () => {
    expect(migration).toContain("v_current_subscription.provider_subscription_id is distinct from p_provider_subscription_id");
    expect(migration).toContain("p_event_type in ('customer.subscription.updated', 'customer.subscription.deleted')");
    expect(migration.match(/set outcome = 'stale', processed_at = now\(\)/g)).toHaveLength(2);
  });
});
