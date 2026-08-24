import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608230015_cross_file_canonical_deduplication.sql"),
  "utf8",
);

describe("cross-file canonical deduplication migration", () => {
  it("serializes workspace canonicalization and keeps corrected mappings independently idempotent", () => {
    expect(migration).toContain(":canonical-import-records");
    expect(migration).toContain("and i.file_sha256 = p_invoice_import ->> 'sha256'");
    expect(migration).toContain("and i.column_mapping = p_invoice_import -> 'columnMapping'");
    expect(migration).toContain("and i.file_sha256 = p_payment_import ->> 'sha256'");
    expect(migration).toContain("and i.column_mapping = p_payment_import -> 'columnMapping'");
  });

  it("preserves provider external IDs and uses a separate canonical dedupe key", () => {
    expect(migration).toContain("set external_id = coalesce(i.external_id, 'file:invoice:' || identity.identity_key)");
    expect(migration).toContain("p.external_id,");
    expect(migration).toContain("dedupe_key = identity.identity_key");
    expect(migration).not.toContain("set external_id = 'invoice:' || identity.identity_key");
    expect(migration).not.toContain("set external_id = 'payment:' || identity.identity_key");
    expect(migration).toContain("'accountId', i.raw_source ->> 'account_id'");
    expect(migration).toContain("'accountId', p.account_reference");
  });

  it("retains every source row and explicitly labels cross-file duplicates", () => {
    expect(migration.match(/jsonb_array_elements\(p_invoice_import -> 'rows'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/jsonb_array_elements\(p_payment_import -> 'rows'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("'duplicate_across_imports'");
    expect(migration).toContain("set canonical_record_id = v_db_id");
    expect(migration).toContain("dedupe_hash = v_identity_key");
  });

  it("carries actionable canonical payments without reinserting or billing them", () => {
    expect(migration).toContain("v_payment.unapplied_amount_minor > 0");
    expect(migration).toContain("v_payment.status not in ('reconciled', 'ignored')");
    expect(migration).toContain("v_carried_payment_client_ids");
    expect(migration).toContain("'{usagePaymentCount}'");
    expect(migration).toContain("v_reservation.payment_count <> v_usage_payment_count");
    expect(migration).toContain("'payments_processed'");
    expect(migration).toContain("v_new_payment_count, 'reconciliation-run:'");
  });

  it("fails closed on stale financial state and removes resolved payments from proposed matches", () => {
    expect(migration).toContain("errcode = '40001', message = 'Canonical invoice state changed; retry reconciliation'");
    expect(migration).toContain("errcode = '40001', message = 'Canonical payment availability changed; retry reconciliation'");
    expect(migration).toContain("where payment_id = any(v_resolved_payment_client_ids)");
  });

  it("keeps remapped invoices confirmable from the current source import", () => {
    expect(migration).toContain("source_row.canonical_record_id = i.id");
    expect(migration).toContain("source_row.normalized_values ->> 'id' = v_client_invoice_id");
    expect(migration).toContain("Latest-run hydration uses the current import's source IDs");
  });

  it("exposes only the canonical-context and v2 persistence contracts to authenticated clients", () => {
    expect(migration).toContain("grant execute on function public.get_reconciliation_import_context(uuid, jsonb, jsonb)");
    expect(migration).toContain("revoke execute on function public.persist_reconciliation_run(uuid, text, text, jsonb, jsonb, jsonb)");
    expect(migration).toContain("grant execute on function public.persist_reconciliation_run_v2(uuid, text, text, jsonb, jsonb, jsonb)");
  });
});
