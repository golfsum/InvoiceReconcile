begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(100);

create or replace function pg_temp.try_sql(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return '00000';
exception when others then
  return sqlstate;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'admin-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'viewer-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'internal-admin@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

update public.profiles set is_internal_admin = true where id = 'c0000000-0000-0000-0000-000000000001';

insert into public.organizations (id, name, created_by)
values
  ('10000000-0000-0000-0000-000000000001', 'Tenant A', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', 'Tenant B', 'b0000000-0000-0000-0000-000000000001');

insert into public.memberships (organization_id, user_id, role, status, joined_at)
values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner', 'active', now()),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'admin', 'active', now()),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'member', 'active', now()),
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'viewer', 'active', now()),
  ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'owner', 'active', now());

insert into public.workspaces (id, organization_id, name, business_name, created_by)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Workspace A', 'Business A', 'a0000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Workspace B', 'Business B', 'b0000000-0000-0000-0000-000000000001');

insert into public.customers (id, workspace_id, name, normalized_name)
values
  ('11100000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Customer A', 'CUSTOMER A'),
  ('11100000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'Customer A2', 'CUSTOMER A2'),
  ('22200000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Customer B', 'CUSTOMER B');

insert into public.imports (
  id, workspace_id, import_type, source_type, status, original_filename,
  storage_bucket, storage_path, content_type, byte_size, file_sha256, created_by
)
values
  ('11200000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'invoices', 'csv', 'completed', 'a.csv', 'import-source-files', '10000000-0000-0000-0000-000000000001/11000000-0000-0000-0000-000000000001/11200000-0000-0000-0000-000000000001/a.csv', 'text/csv', 10, repeat('a', 64), 'a0000000-0000-0000-0000-000000000001'),
  ('22200000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', 'invoices', 'csv', 'completed', 'b.csv', 'import-source-files', '20000000-0000-0000-0000-000000000001/22000000-0000-0000-0000-000000000001/22200000-0000-0000-0000-000000000002/b.csv', 'text/csv', 10, repeat('b', 64), 'b0000000-0000-0000-0000-000000000001');

insert into public.invoices (
  id, workspace_id, customer_id, import_id, invoice_number, normalized_invoice_number,
  invoice_date, original_amount_minor, outstanding_balance_minor, currency_code, raw_source
)
values
  ('11300000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', '11200000-0000-0000-0000-000000000001', 'A-1', 'A1', current_date, 10000, 10000, 'USD', '{"client_id":"invoice-client-a"}'),
  ('11300000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', '11200000-0000-0000-0000-000000000001', 'A-2', 'A2', current_date, 5000, 5000, 'USD', '{"client_id":"invoice-client-a2"}'),
  ('11300000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', '11200000-0000-0000-0000-000000000001', 'A-EUR', 'AEUR', current_date, 1000, 1000, 'EUR', '{"client_id":"invoice-client-eur"}'),
  ('22300000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '22200000-0000-0000-0000-000000000001', '22200000-0000-0000-0000-000000000002', 'B-1', 'B1', current_date, 20000, 20000, 'USD', '{"client_id":"invoice-client-b"}');

insert into public.payments (
  id, workspace_id, transaction_date, amount_minor, unapplied_amount_minor,
  currency_code, status, dedupe_key
)
values
  ('11400000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', current_date, 10000, 10000, 'USD', 'unmatched', 'payment-a'),
  ('22400000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', current_date, 20000, 20000, 'USD', 'unmatched', 'payment-b');

update public.invoices
set external_id = 'provider-invoice-a',
    dedupe_key = app_private.record_identity_hash(app_private.invoice_record_identity(jsonb_build_object(
      'invoiceNumber', 'A-1',
      'customerName', 'Customer A',
      'currency', 'USD',
      'originalAmountMinor', 10000
    )))
where id = '11300000-0000-0000-0000-000000000001';

update public.payments
set external_id = 'provider-payment-a',
    raw_source = '{"client_id":"payment-client-a","transaction_id":"TX-A"}'::jsonb,
    dedupe_key = app_private.record_identity_hash(app_private.payment_record_identity(jsonb_build_object(
      'transactionId', 'TX-A',
      'paymentDate', current_date,
      'amountMinor', 10000,
      'currency', 'USD'
    )))
where id = '11400000-0000-0000-0000-000000000001';

insert into public.reconciliation_usage_reservations (
  id, organization_id, workspace_id, run_key, engine_version,
  period_start, period_end, plan_code, payment_count, reserved_by, expires_at
)
values
  ('11800000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'tenant-a-run', 'test-v1', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date, 'free', 0, 'a0000000-0000-0000-0000-000000000001', now() + interval '15 minutes'),
  ('22800000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'tenant-b-run', 'test-v1', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date, 'free', 0, 'b0000000-0000-0000-0000-000000000001', now() + interval '15 minutes');

insert into public.reconciliation_runs (
  id, workspace_id, invoice_import_id, payment_import_id, run_key,
  engine_version, snapshot, created_by
)
values
  ('11700000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '11200000-0000-0000-0000-000000000001', '11200000-0000-0000-0000-000000000001', 'tenant-a-run', 'test-v1', '{"runId":"tenant-a-run","invoices":[],"payments":[],"result":{"matches":[]}}', 'a0000000-0000-0000-0000-000000000001'),
  ('22700000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '22200000-0000-0000-0000-000000000002', '22200000-0000-0000-0000-000000000002', 'tenant-b-run', 'test-v1', '{"runId":"tenant-b-run","invoices":[],"payments":[],"result":{"matches":[]}}', 'b0000000-0000-0000-0000-000000000001');

insert into public.matches (
  id, workspace_id, reconciliation_run_id, client_match_id, payment_id, confidence_category, matching_method,
  engine_version, idempotency_key, payment_amount_minor,
  proposed_application_minor, currency_code
)
values (
  '11500000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '11700000-0000-0000-0000-000000000001',
  'match-client-a',
  '11400000-0000-0000-0000-000000000001',
  'exact', 'exact_one_to_one', 'test-v1', 'match-a', 10000, 10000, 'USD'
);

insert into public.match_payment_links (workspace_id, match_id, payment_id, amount_minor)
values ('11000000-0000-0000-0000-000000000001', '11500000-0000-0000-0000-000000000001', '11400000-0000-0000-0000-000000000001', 10000);

insert into public.match_explanations (
  workspace_id, match_id, reason_code, strength, display_order, explanation_text, evidence
)
values (
  '11000000-0000-0000-0000-000000000001',
  '11500000-0000-0000-0000-000000000001',
  'amount_exact', 'strong', 1, 'Payment and proposed invoice total are equal.', '{"amount_minor":10000}'
);

insert into public.subscriptions (organization_id, plan_code, status, unit_amount_minor)
values ('10000000-0000-0000-0000-000000000001', 'solo', 'active', 1900);

insert into public.background_jobs (id, organization_id, workspace_id, job_type, status, idempotency_key)
values ('11600000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'process_import', 'failed', 'job-a');

insert into public.analytics_events (event_name, anonymous_id, user_id, organization_id, workspace_id)
values ('first_reconciliation_completed', gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001');

insert into storage.objects (bucket_id, name)
values
  ('import-source-files', '10000000-0000-0000-0000-000000000001/11000000-0000-0000-0000-000000000001/11200000-0000-0000-0000-000000000001/a.csv'),
  ('import-source-files', '20000000-0000-0000-0000-000000000001/22000000-0000-0000-0000-000000000001/22200000-0000-0000-0000-000000000002/b.csv');

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any(array[
       'profiles', 'organizations', 'memberships', 'workspaces', 'customers',
       'payer_aliases', 'payment_sources', 'imports', 'import_rows', 'invoices', 'payments', 'matches',
       'match_invoice_links', 'match_payment_links', 'match_explanations', 'matching_rules', 'reconciliation_runs',
       'reconciliation_actions', 'audit_events', 'integrations', 'subscriptions',
       'reconciliation_usage_reservations',
       'usage_records', 'analytics_events', 'analytics_daily_aggregates', 'feedback',
       'background_jobs', 'application_errors', 'contact_requests'
     ])),
  'RLS is enabled on every public application table'
);

select is((select public from storage.buckets where id = 'import-source-files'), false, 'source file bucket is private');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.customers), 2::bigint, 'tenant A owner reads only tenant A customers');
select is((select count(*) from public.invoices where id = '22300000-0000-0000-0000-000000000001'), 0::bigint, 'tenant A owner cannot read tenant B invoices');
select is((select count(*) from public.reconciliation_runs), 1::bigint, 'tenant A owner reads only tenant A reconciliation runs');
select is((select count(*) from public.match_payment_links), 1::bigint, 'tenant A owner reads payment links in the same workspace');
select is((select count(*) from public.get_workspace_portfolio_metrics()), 1::bigint, 'portfolio metrics include only accessible workspaces');
select is((select matched_payments from public.get_workspace_portfolio_metrics()), 1::bigint, 'portfolio metrics classify the latest exact payment as matched');
select is((select count(*) from storage.objects where bucket_id = 'import-source-files'), 1::bigint, 'tenant A owner reads only tenant A source files');
select is(
  public.reserve_reconciliation_capacity('11000000-0000-0000-0000-000000000001', 'tenant-a-run', 'test-v1', 0) #>> '{code}',
  'already_processed',
  'replaying a persisted reconciliation run does not reserve or count payments again'
);
select is(
  public.reserve_reconciliation_capacity('11000000-0000-0000-0000-000000000001', 'new-limit-run', 'test-v1', 501) #>> '{code}',
  'payment_limit_exceeded',
  'capacity RPC returns a structured denial before a run exceeds the Solo monthly limit'
);
select is(
  pg_temp.try_sql($sql$insert into public.customers (workspace_id, name, normalized_name) values ('22000000-0000-0000-0000-000000000001', 'Blocked', 'BLOCKED')$sql$),
  '42501',
  'cross-organization customer insert is rejected'
);
select is(
  pg_temp.try_sql($sql$select public.persist_reconciliation_run_v2('22000000-0000-0000-0000-000000000001', 'blocked-run', 'test-v1', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)$sql$),
  '42501',
  'persistence RPC rejects a cross-workspace run before accepting payload data'
);
select is(
  has_function_privilege('authenticated', 'public.persist_reconciliation_run(uuid,text,text,jsonb,jsonb,jsonb)', 'execute'),
  false,
  'authenticated clients cannot call the legacy noncanonical persistence RPC'
);
select is(
  has_function_privilege('authenticated', 'public.persist_reconciliation_run_v2(uuid,text,text,jsonb,jsonb,jsonb)', 'execute'),
  true,
  'authenticated clients can call only the canonical v2 persistence RPC'
);
select is(
  public.get_reconciliation_import_context(
    '11000000-0000-0000-0000-000000000001',
    '[{"id":"incoming-invoice-a","invoiceNumber":"A-1","customerName":"Customer A","currency":"USD","originalAmountMinor":10000,"outstandingAmountMinor":10000,"status":"open"}]'::jsonb,
    '[{"id":"incoming-payment-a","transactionId":"TX-A","paymentDate":"2026-08-23","amountMinor":10000,"currency":"USD"}]'::jsonb
  ) #>> '{invoice_states,0,client_id}',
  'incoming-invoice-a',
  'canonical context remaps a cumulative invoice snapshot to its existing invoice'
);
select is(
  public.get_reconciliation_import_context(
    '11000000-0000-0000-0000-000000000001',
    '[]'::jsonb,
    '[{"id":"incoming-payment-a","transactionId":"TX-A","paymentDate":"2026-08-23","amountMinor":10000,"currency":"USD"}]'::jsonb
  ) #>> '{payment_states,0,unapplied_amount_minor}',
  '10000',
  'canonical context carries the current unapplied amount for a repeated unresolved payment'
);
select is(
  pg_temp.try_sql($sql$select public.get_reconciliation_import_context('22000000-0000-0000-0000-000000000001', '[]'::jsonb, '[]'::jsonb)$sql$),
  '42501',
  'canonical context rejects cross-workspace record discovery'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('22000000-0000-0000-0000-000000000001', '22700000-0000-0000-0000-000000000001', 'blocked-match', 'rejected', '[]'::jsonb, 0, null, 0, null, 'blocked-decision')$sql$),
  '42501',
  'decision RPC rejects a cross-workspace mutation before locking financial rows'
);
select is(
  has_function_privilege('authenticated', 'public.record_reconciliation_decision(uuid,uuid,text,text,text[],text,bigint,text,text)', 'execute'),
  false,
  'authenticated clients cannot bypass explicit allocations through the legacy decision RPC'
);
select is(
  pg_temp.try_sql($sql$select public.get_workspace_audit_events('22000000-0000-0000-0000-000000000001', null, 25)$sql$),
  '42501',
  'audit RPC rejects cross-workspace history access'
);
select is(
  pg_temp.try_sql($sql$select public.get_latest_reconciliation_run('22000000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'latest-run RPC rejects cross-workspace snapshot access'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_export('22000000-0000-0000-0000-000000000001', '22700000-0000-0000-0000-000000000001', 'audit', 'csv', 1, 'blocked-export')$sql$),
  '42501',
  'export RPC rejects a cross-workspace audit mutation'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":5000},{"invoiceId":"invoice-client-a","amountMinor":5000}]'::jsonb, 10000, null, 0, null, 'invalid-duplicate')$sql$),
  '22023',
  'decision RPC rejects duplicate invoice allocations'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":1.5}]'::jsonb, 1, null, 0, null, 'invalid-fraction')$sql$),
  '22023',
  'decision RPC requires integer minor-unit allocations'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":5000}]'::jsonb, 4000, null, 0, null, 'invalid-total')$sql$),
  '22023',
  'decision RPC requires the supplied total to equal the allocation sum'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-eur","amountMinor":1000}]'::jsonb, 1000, null, 0, null, 'invalid-currency')$sql$),
  '22023',
  'decision RPC rejects an invoice in another currency'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a2","amountMinor":5001}]'::jsonb, 5001, null, 0, null, 'invalid-balance')$sql$),
  '22023',
  'decision RPC rejects an allocation above the invoice balance'
);
select is(
  pg_temp.try_sql($sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":6000},{"invoiceId":"invoice-client-a2","amountMinor":5000}]'::jsonb, 11000, null, 0, null, 'invalid-payment-total')$sql$),
  '22023',
  'decision RPC rejects allocations above the available payment amount'
);
select lives_ok(
  $sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":6000},{"invoiceId":"invoice-client-a2","amountMinor":4000}]'::jsonb, 10000, 'Reviewed against the remittance', 0, 'correct', 'decision-a')$sql$,
  'workspace editor can commit exact split and partial reconciliation allocations'
);
select is(
  (select outstanding_balance_minor from public.invoices where id = '11300000-0000-0000-0000-000000000001'),
  4000::bigint,
  'confirmed decision applies the explicit partial amount to the first invoice'
);
select is(
  (select outstanding_balance_minor from public.invoices where id = '11300000-0000-0000-0000-000000000002'),
  1000::bigint,
  'confirmed decision applies the explicit split amount to the second invoice'
);
select is(
  (select applied_amount_minor from public.match_invoice_links where invoice_id = '11300000-0000-0000-0000-000000000001'),
  6000::bigint,
  'the first persisted match link retains its reviewer-selected amount'
);
select is(
  (select applied_amount_minor from public.match_invoice_links where invoice_id = '11300000-0000-0000-0000-000000000002'),
  4000::bigint,
  'the second persisted match link retains its reviewer-selected amount'
);
select lives_ok(
  $sql$select public.record_reconciliation_decision_v2('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'match-client-a', 'confirmed', '[{"invoiceId":"invoice-client-a","amountMinor":6000},{"invoiceId":"invoice-client-a2","amountMinor":4000}]'::jsonb, 10000, 'Reviewed against the remittance', 0, 'correct', 'decision-a')$sql$,
  'replaying an idempotency key returns the original decision without applying balances twice'
);
select is(
  (select count(*) from public.reconciliation_actions where reconciliation_run_id = '11700000-0000-0000-0000-000000000001'),
  1::bigint,
  'confirmed decision appends one immutable reconciliation action'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,actor,name}',
  'owner-a@example.test',
  'audit history returns the actual event actor to an authorized workspace member'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,action,previousState,matchStatus}',
  'suggested',
  'audit history returns the immutable previous decision state'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,sourceImport,id}',
  '11200000-0000-0000-0000-000000000001',
  'decision audit event retains its payment source import link'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,metadata,payment_links,0,recordId}',
  '11400000-0000-0000-0000-000000000001',
  'decision audit metadata retains the immutable payment record link'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,metadata,matching_method}',
  'exact_one_to_one',
  'decision audit metadata retains the automated matching method'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,metadata,match_evidence,0,code}',
  'amount_exact',
  'decision audit metadata retains the automated matching evidence'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,action,newState,invoiceApplications,0,invoiceId}',
  'invoice-client-a',
  'decision action retains the exact invoice application link'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,metadata,invoice_allocations,1,amountMinor}',
  '4000',
  'decision audit metadata retains each explicit invoice allocation amount'
);
select is(
  public.get_latest_reconciliation_run('11000000-0000-0000-0000-000000000001') #>> '{invoice_states,invoice-client-a,outstandingAmountMinor}',
  '4000',
  'latest-run state includes the current canonical invoice balance'
);
select is(
  public.get_latest_reconciliation_run('11000000-0000-0000-0000-000000000001') #>> '{invoice_states,invoice-client-a2,outstandingAmountMinor}',
  '1000',
  'latest-run state includes the second explicitly allocated invoice balance'
);
select lives_ok(
  $sql$select public.record_reconciliation_export('11000000-0000-0000-0000-000000000001', '11700000-0000-0000-0000-000000000001', 'audit', 'csv', 1, 'export-a')$sql$,
  'workspace member can append an export audit event'
);
select is(
  public.get_workspace_audit_events('11000000-0000-0000-0000-000000000001', null, 25) #>> '{events,0,eventType}',
  'reconciliation_export.created',
  'paginated audit history includes recorded exports'
);
select is(
  pg_temp.try_sql($sql$update public.invoices set workspace_id = '22000000-0000-0000-0000-000000000001' where id = '11300000-0000-0000-0000-000000000001'$sql$),
  '42501',
  'tenant key reassignment is rejected'
);
select is(
  pg_temp.try_sql($sql$insert into public.imports (workspace_id, import_type, source_type, status, file_sha256, created_by) values ('11000000-0000-0000-0000-000000000001', 'invoices', 'csv', 'uploaded', repeat('a', 64), 'a0000000-0000-0000-0000-000000000001')$sql$),
  '23505',
  'duplicate file import fingerprint is rejected'
);
select is(
  pg_temp.try_sql($sql$insert into public.imports (workspace_id, import_type, source_type, status, file_sha256, created_by) values ('11000000-0000-0000-0000-000000000001', 'payments', 'csv', 'uploaded', repeat('c', 64), 'a0000000-0000-0000-0000-000000000003')$sql$),
  '42501',
  'authenticated users cannot spoof import creator history'
);
select is(
  pg_temp.try_sql($sql$insert into public.payments (workspace_id, transaction_date, amount_minor, unapplied_amount_minor, currency_code, dedupe_key) values ('11000000-0000-0000-0000-000000000001', current_date, 10000, 10000, 'USD', '08d9d879696607330fe385317eb72238c9dde23be98763ce32ada16db78784d6')$sql$),
  '23505',
  'duplicate payment dedupe key is rejected'
);
select is(
  pg_temp.try_sql($sql$insert into public.matches (workspace_id, payment_id, confidence_category, matching_method, engine_version, idempotency_key, payment_amount_minor, proposed_application_minor, currency_code) values ('11000000-0000-0000-0000-000000000001', '11400000-0000-0000-0000-000000000001', 'exact', 'exact_one_to_one', 'test-v1', 'match-a', 10000, 10000, 'USD')$sql$),
  '23505',
  'duplicate match idempotency key is rejected'
);
select is(
  pg_temp.try_sql($sql$update public.profiles set is_internal_admin = true where id = 'a0000000-0000-0000-0000-000000000001'$sql$),
  '42501',
  'a user cannot elevate their internal admin flag'
);
select lives_ok(
  $sql$select public.update_workspace_settings('11000000-0000-0000-0000-000000000001', 'Business A updated', 'USD', 'UTC', 'accrual', 90)$sql$,
  'organization owner can update workspace settings through the audited function'
);
select is(
  pg_temp.try_sql($sql$update public.workspaces set name = 'Direct update' where id = '11000000-0000-0000-0000-000000000001'$sql$),
  '42501',
  'organization owner cannot bypass the audited workspace settings function'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'description_pattern', 'Parent remittance', '11100000-0000-0000-0000-000000000001')$sql$),
  'P0001',
  'Solo cannot create plan-gated custom matching rules through the direct RPC'
);

reset role;
update public.subscriptions
set plan_code = 'business'
where organization_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  pg_temp.try_sql($sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'reference_pattern', 'NS-{digits}-{digits}')$sql$),
  '22023',
  'custom rule RPC rejects repeated occurrences of the same template token'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'reference_pattern', 'Café-{digits}')$sql$),
  '22023',
  'custom rule RPC rejects non-ASCII templates instead of creating runtime normalization drift'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'description_pattern', 'Cross tenant remittance', '22200000-0000-0000-0000-000000000001')$sql$),
  '22023',
  'custom rule RPC rejects a customer from another workspace'
);
select lives_ok(
  $sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'description_pattern', 'Parent remittance', '11100000-0000-0000-0000-000000000001')$sql$,
  'workspace editor can create an audited description customer rule'
);
select lives_ok(
  $sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'reference_pattern', 'NS-2026-{digits}')$sql$,
  'workspace editor can create an audited bounded reference template'
);
select lives_ok(
  $sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'fee_behavior', 'Card settlement', null, 500, 300)$sql$,
  'workspace editor can create an audited fee-review evidence rule'
);
select is(
  pg_temp.try_sql($sql$insert into public.matching_rules (workspace_id, name, rule_type, source_pattern, normalized_pattern, action_type, configuration, created_by) values ('11000000-0000-0000-0000-000000000001', 'Direct custom rule', 'reference_pattern', 'BAD-{DIGITS}', 'BAD-{DIGITS}', 'extract_reference', '{"templateVersion":1}', 'a0000000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'authenticated editors cannot bypass audited custom rule RPCs with direct DML'
);
select ok(
  (
    select count(*) = 3
      and bool_and(jsonb_typeof(metadata -> 'previous_state') = 'object')
      and bool_and(jsonb_typeof(metadata -> 'current_state') = 'object')
      and bool_and(metadata::text !~* 'raw_source|storage_path|signed_url')
    from public.audit_events
    where workspace_id = '11000000-0000-0000-0000-000000000001'
      and event_type = 'matching_rule.created'
  ),
  'custom rule creation audits previous and current sanitized state'
);
select lives_ok(
  $sql$select public.update_workspace_custom_matching_rule(
    '11000000-0000-0000-0000-000000000001',
    (select id from public.matching_rules where workspace_id = '11000000-0000-0000-0000-000000000001' and rule_type = 'description_pattern' and is_active limit 1),
    'description_pattern', 'Updated remittance', '11100000-0000-0000-0000-000000000002'
  )$sql$,
  'workspace editor can update a custom rule through the audited RPC'
);
select ok(
  (
    select jsonb_typeof(metadata -> 'previous_state') = 'object'
      and jsonb_typeof(metadata -> 'current_state') = 'object'
    from public.audit_events
    where workspace_id = '11000000-0000-0000-0000-000000000001'
      and event_type = 'matching_rule.updated'
    order by id desc
    limit 1
  ),
  'custom rule updates audit both previous and current state'
);

reset role;
update public.subscriptions
set plan_code = 'solo'
where organization_id = '10000000-0000-0000-0000-000000000001';
update public.organizations
set status = 'suspended'
where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $sql$select public.delete_workspace_custom_matching_rule(
    '11000000-0000-0000-0000-000000000001',
    (select id from public.matching_rules where workspace_id = '11000000-0000-0000-0000-000000000001' and rule_type = 'reference_pattern' and is_active limit 1)
  )$sql$,
  'workspace editor can delete an existing custom rule after plan downgrade and organization suspension'
);
select ok(
  (
    select jsonb_typeof(metadata -> 'previous_state') = 'object'
      and jsonb_typeof(metadata -> 'current_state') = 'object'
    from public.audit_events
    where workspace_id = '11000000-0000-0000-0000-000000000001'
      and event_type = 'matching_rule.deleted'
    order by id desc
    limit 1
  ),
  'custom rule deletion audits both previous and current state'
);

reset role;
update public.organizations
set status = 'active'
where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  pg_temp.try_sql($sql$select public.update_workspace_custom_matching_rule(
    '11000000-0000-0000-0000-000000000001',
    (select id from public.matching_rules where workspace_id = '11000000-0000-0000-0000-000000000001' and rule_type = 'description_pattern' and is_active limit 1),
    'description_pattern', 'Downgraded update', '11100000-0000-0000-0000-000000000001'
  )$sql$),
  'P0001',
  'plan downgrade blocks custom rule updates through the direct RPC'
);
select lives_ok(
  $sql$select public.create_workspace_payer_mapping('11000000-0000-0000-0000-000000000001', 'ACH ORIG: PARENT TREASURY', '11100000-0000-0000-0000-000000000001')$sql$,
  'workspace editor can create an audited payer mapping'
);
select is(
  public.create_workspace_payer_mapping('11000000-0000-0000-0000-000000000001', 'PARENT TREASURY LLC', '11100000-0000-0000-0000-000000000001') #>> '{existing}',
  'true',
  'behaviorally equivalent payer aliases are idempotent for the same customer'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_payer_mapping('11000000-0000-0000-0000-000000000001', 'PARENT TREASURY LLC', '11100000-0000-0000-0000-000000000002')$sql$),
  '23505',
  'one normalized payer cannot map to different active customers in a workspace'
);
select is(
  (select count(*) from public.payer_aliases where workspace_id = '11000000-0000-0000-0000-000000000001' and is_active),
  1::bigint,
  'created payer mapping is active only in its workspace'
);
select is(
  (select count(*) from public.audit_events where workspace_id = '11000000-0000-0000-0000-000000000001' and event_type = 'payer_mapping.created'),
  1::bigint,
  'payer mapping creation appends an audit event'
);
select is(
  pg_temp.try_sql($sql$insert into public.payer_aliases (workspace_id, customer_id, alias, normalized_alias, confirmed_by) values ('11000000-0000-0000-0000-000000000001', '11100000-0000-0000-0000-000000000001', 'Direct alias', 'DIRECT ALIAS', 'a0000000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'authenticated clients cannot bypass the audited payer mapping function'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_payer_mapping('22000000-0000-0000-0000-000000000001', 'Cross tenant alias', '22200000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'payer mapping function rejects cross-workspace creation'
);
select lives_ok(
  $sql$select public.delete_workspace_payer_mapping('11000000-0000-0000-0000-000000000001', (select id from public.payer_aliases where workspace_id = '11000000-0000-0000-0000-000000000001' and is_active limit 1))$sql$,
  'workspace editor can delete a payer mapping through the audited function'
);
select is(
  (select count(*) from public.audit_events where workspace_id = '11000000-0000-0000-0000-000000000001' and event_type = 'payer_mapping.deleted'),
  1::bigint,
  'payer mapping deletion appends an audit event'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000004', true);
select is(
  pg_temp.try_sql($sql$insert into public.customers (workspace_id, name, normalized_name) values ('11000000-0000-0000-0000-000000000001', 'Viewer write', 'VIEWER WRITE')$sql$),
  '42501',
  'viewer cannot insert financial records'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_payer_mapping('11000000-0000-0000-0000-000000000001', 'Viewer alias', '11100000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'viewer cannot create payer mappings'
);
select is(
  (select count(*) from public.matching_rules where workspace_id = '11000000-0000-0000-0000-000000000001'),
  3::bigint,
  'viewer can inspect active and inactive custom matching rule history in the workspace'
);
select is(
  pg_temp.try_sql($sql$select public.create_workspace_custom_matching_rule('11000000-0000-0000-0000-000000000001', 'description_pattern', 'Viewer remittance', '11100000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'viewer cannot create custom matching rules'
);
select is(
  pg_temp.try_sql($sql$update public.workspaces set name = 'Viewer changed' where id = '11000000-0000-0000-0000-000000000001'$sql$),
  '42501',
  'viewer cannot update workspace settings directly'
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
select is(
  pg_temp.try_sql($sql$update public.memberships set role = 'owner' where user_id = 'a0000000-0000-0000-0000-000000000003'$sql$),
  '42501',
  'organization admin cannot promote a member to owner'
);
select is(
  pg_temp.try_sql($sql$insert into storage.objects (bucket_id, name) values ('import-source-files', '10000000-0000-0000-0000-000000000001/11000000-0000-0000-0000-000000000001/not-an-import/bad.csv')$sql$),
  '42501',
  'storage upload path must reference a real import'
);

select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
select is((select count(*) from public.profiles), 6::bigint, 'internal admin can review signups');
select is((select count(*) from public.subscriptions), 1::bigint, 'internal admin can review subscriptions and MRR inputs');
select is((select count(*) from public.background_jobs where status = 'failed'), 1::bigint, 'internal admin can review failed jobs');
select is((select count(*) from public.analytics_events), 1::bigint, 'internal admin can review privacy-safe product history');
select is((select count(*) from public.invoices), 0::bigint, 'internal admin cannot read tenant invoices');
select is((select count(*) from public.payments), 0::bigint, 'internal admin cannot read tenant payments');
select is((select count(*) from public.reconciliation_runs), 0::bigint, 'internal admin cannot read tenant reconciliation snapshots');
select is((select count(*) from public.get_workspace_portfolio_metrics()), 0::bigint, 'internal admin cannot read tenant workspace portfolio metrics');
select is((select count(*) from storage.objects where bucket_id = 'import-source-files'), 0::bigint, 'internal admin cannot read private tenant files');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is(
  pg_temp.try_sql($sql$insert into public.analytics_events (event_name, anonymous_id, organization_id) values ('page_viewed', gen_random_uuid(), '10000000-0000-0000-0000-000000000001')$sql$),
  '42501',
  'anonymous analytics cannot claim an organization'
);
select is(
  pg_temp.try_sql($sql$insert into public.analytics_events (event_name, anonymous_id, path) values ('page_viewed', gen_random_uuid(), '/pricing')$sql$),
  '42501',
  'anonymous analytics must use the validated application route'
);
select is(
  pg_temp.try_sql($sql$insert into public.contact_requests (name, email, message) values ('Test Person', 'person@example.test', 'Please contact me')$sql$),
  '42501',
  'public contact requests must use the validated application route'
);

reset role;
set local role service_role;
select lives_ok(
  $sql$insert into public.analytics_events (event_name, anonymous_id, path) values ('page_viewed', gen_random_uuid(), '/pricing')$sql$,
  'trusted route writer can insert a validated analytics event'
);
select lives_ok(
  $sql$insert into public.contact_requests (name, email, message) values ('Test Person', 'person@example.test', 'Please contact me')$sql$,
  'trusted route writer can store a validated contact request'
);

reset role;
select * from finish();
rollback;
