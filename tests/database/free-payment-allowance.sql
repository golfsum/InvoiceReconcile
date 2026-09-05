-- Run against the migrated database with: supabase db query --linked --file ...
-- Every fixture and RPC write is rolled back. No storage objects or emails are sent.
begin;
do $$
declare
  actor uuid := gen_random_uuid();
  org uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  invoice_source uuid := gen_random_uuid();
  payment_source uuid := gen_random_uuid();
  request_id uuid;
  result jsonb;
  claim jsonb;
  plan text;
  allowance bigint;
  invoice_mapping jsonb := '{"invoiceNumber":"Number","customerName":"Customer","invoiceDate":"Date","originalAmount":"Amount"}';
  payment_mapping jsonb := '{"paymentDate":"Date","amount":"Amount"}';
begin
  assert app_private.monthly_payment_limit('free') = 20, 'Free policy must be 20';
  assert app_private.monthly_payment_limit(null) = 20, 'Missing plan must fall back to Free';
  assert not has_function_privilege('anon', 'public.reserve_reconciliation_capacity(uuid,text,text,bigint)', 'execute');
  assert not has_function_privilege('authenticated', 'public.worker_claim_async_reconciliation(uuid,text)', 'execute');

  insert into auth.users (id, email) values (actor, actor::text || '@example.invalid');
  insert into public.profiles (id, email) values (actor, actor::text || '@example.invalid') on conflict (id) do nothing;
  insert into public.organizations (id, name, created_by) values (org, 'Rolled-back pricing QA', actor);
  insert into public.memberships (organization_id, user_id, role) values (org, actor, 'owner');
  insert into public.workspaces (id, organization_id, name, business_name, created_by)
    values (workspace, org, 'Rolled-back pricing QA', 'Fictional pricing QA', actor);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);

  result := public.reserve_reconciliation_capacity(workspace, 'pricing-denied-21', 'qa', 21);
  assert result @> '{"allowed":false,"limit":20,"used":0,"requested":21}', '21 must be denied';
  result := public.reserve_reconciliation_capacity(workspace, 'pricing-allowed-20', 'qa', 20);
  assert result @> '{"allowed":true,"limit":20,"remaining":0}', '20 must be allowed';
  result := public.reserve_reconciliation_capacity(workspace, 'pricing-allowed-20', 'qa', 20);
  assert result @> '{"allowed":true,"code":"already_reserved","remaining":0}', 'Retry must not double count';
  result := public.reserve_reconciliation_capacity(workspace, 'pricing-pending-1', 'qa', 1);
  assert result @> '{"allowed":false,"limit":20,"used":20}', 'Pending usage must block payment 21';
  result := public.reserve_reconciliation_capacity(workspace, 'pricing-duplicate-0', 'qa', 0);
  assert result @> '{"allowed":true,"requested":0}', 'Zero new payments must fit at the limit';
  update public.reconciliation_usage_reservations set expires_at = now() - interval '1 minute' where organization_id = org;

  foreach plan in array array['solo','business','bookkeeper'] loop
    allowance := app_private.monthly_payment_limit(plan);
    assert allowance = case plan when 'solo' then 500 when 'business' then 2500 else 10000 end;
    insert into public.subscriptions (organization_id, plan_code, status) values (org, plan, 'active')
      on conflict (organization_id) do update set plan_code = excluded.plan_code, status = excluded.status;
    result := public.reserve_reconciliation_capacity(workspace, 'pricing-paid-' || plan, 'qa', allowance);
    assert (result->>'allowed')::boolean and (result->>'limit')::bigint = allowance, 'Paid allowance changed';
    update public.reconciliation_usage_reservations set expires_at = now() - interval '1 minute' where organization_id = org;
  end loop;
  update public.subscriptions set status = 'canceled' where organization_id = org;
  result := public.reserve_reconciliation_capacity(workspace, 'pricing-downgrade-21', 'qa', 21);
  assert result @> '{"allowed":false,"plan":"free","limit":20}', 'Canceled plans must return to Free 20';

  insert into public.import_source_uploads (
    id, organization_id, workspace_id, created_by, import_kind, source_type,
    expected_content_type, expected_byte_size, expected_sha256, storage_path,
    idempotency_key, status, upload_expires_at, source_headers, row_count
  ) values
    (invoice_source, org, workspace, actor, 'invoice', 'csv', 'text/csv', 100, repeat('a',64),
      'rolled-back-pricing-qa/invoices.csv', gen_random_uuid(), 'preview_ready', now()+interval '1 hour', '["Number","Customer","Date","Amount"]', 100),
    (payment_source, org, workspace, actor, 'payment', 'csv', 'text/csv', 100, repeat('b',64),
      'rolled-back-pricing-qa/payments.csv', gen_random_uuid(), 'preview_ready', now()+interval '1 hour', '["Date","Amount"]', 21);
  result := public.enqueue_async_reconciliation(workspace, invoice_source, payment_source, invoice_mapping, payment_mapping, gen_random_uuid());
  assert result @> '{"allowed":false,"limit":20,"requested":21}', 'Background enqueue must reject 21';
  update public.import_source_uploads set row_count = 20 where id = payment_source;
  result := public.enqueue_async_reconciliation(workspace, invoice_source, payment_source, invoice_mapping, payment_mapping, gen_random_uuid());
  assert (result->>'allowed')::boolean, '20 payments and 100 invoice rows must enqueue';
  request_id := (result->>'request_id')::uuid;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'service_role')::text, true);
  update public.import_source_uploads set row_count = 21 where id = payment_source;
  result := public.worker_claim_async_reconciliation(request_id, 'pricing-qa-step');
  assert result->>'status' = 'plan_capacity_rejected', 'Worker claim must recheck 20 limit';

  update public.import_source_uploads set row_count = 20 where id = payment_source;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'authenticated')::text, true);
  result := public.enqueue_async_reconciliation(workspace, invoice_source, payment_source, invoice_mapping, payment_mapping, gen_random_uuid());
  request_id := (result->>'request_id')::uuid;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'service_role')::text, true);
  claim := public.worker_claim_async_reconciliation(request_id, 'pricing-qa-step-2');
  assert claim->>'status' = 'claimed', 'Worker must accept 20 payment source';
  result := public.worker_complete_async_reconciliation(request_id, 'pricing-qa-step-2', claim->>'worker_token',
    'pricing-worker-denied', 'qa', 21, '{}', '{}', '{}', '{"invoices":100,"payments":21,"matches":0,"review":0,"issues":0}');
  assert result @> '{"allowed":false,"limit":20,"code":"payment_limit_exceeded"}', 'Worker completion must enforce quota before saving';
  assert not exists(select 1 from public.reconciliation_runs where workspace_id = workspace), 'Denied work must not create financial records';
end;
$$;
rollback;
select 'PASS: Free 20/21, retries, pending usage, zero-new-payment runs, paid limits, downgrade and all background gates; fixtures rolled back' as result;
