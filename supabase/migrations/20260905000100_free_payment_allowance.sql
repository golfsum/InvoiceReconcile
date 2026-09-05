begin;

-- Keep all four admission/completion checks on one plan policy.
-- Existing financial records, usage, reservations and subscriptions are retained.
create or replace function app_private.monthly_payment_limit(p_plan_code text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case p_plan_code
    when 'solo' then 500
    when 'business' then 2500
    when 'bookkeeper' then 10000
    else 20
  end::bigint;
$$;

revoke all on function app_private.monthly_payment_limit(text)
from public, anon, authenticated, service_role;

create or replace function public.reserve_reconciliation_capacity(
  p_workspace_id uuid,
  p_run_key text,
  p_engine_version text,
  p_payment_count bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_subscription public.subscriptions%rowtype;
  v_plan_code text := 'free';
  v_payment_limit bigint := 20;
  v_period_start date;
  v_period_end date;
  v_existing_run_id uuid;
  v_existing_reservation public.reconciliation_usage_reservations%rowtype;
  v_has_existing_reservation boolean := false;
  v_recorded_usage bigint := 0;
  v_pending_usage bigint := 0;
  v_used bigint := 0;
  v_reservation_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_run_key is null or p_run_key !~ '^[A-Za-z0-9:_-]{8,190}$' then
    raise exception using errcode = '22023', message = 'The reconciliation run key is invalid';
  end if;
  if p_engine_version is null or btrim(p_engine_version) = '' or char_length(p_engine_version) > 100 then
    raise exception using errcode = '22023', message = 'The engine version is invalid';
  end if;
  if p_payment_count is null or p_payment_count < 0 or p_payment_count > 50000 then
    raise exception using errcode = '22023', message = 'The payment count is invalid';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id and w.status = 'active';
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  select s.* into v_subscription
  from public.subscriptions s
  where s.organization_id = v_organization_id;

  if found and v_subscription.status in ('active', 'trialing', 'past_due') then
    v_plan_code := v_subscription.plan_code;
  end if;
  v_payment_limit := app_private.monthly_payment_limit(v_plan_code);

  if v_plan_code <> 'free'
     and v_subscription.current_period_starts_at is not null
     and v_subscription.current_period_ends_at is not null
     and v_subscription.current_period_ends_at > v_subscription.current_period_starts_at
     and v_now >= v_subscription.current_period_starts_at
     and v_now < v_subscription.current_period_ends_at then
    v_period_start := (v_subscription.current_period_starts_at at time zone 'UTC')::date;
    v_period_end := ((v_subscription.current_period_ends_at - interval '1 microsecond') at time zone 'UTC')::date;
  else
    v_period_start := date_trunc('month', v_now at time zone 'UTC')::date;
    v_period_end := (date_trunc('month', v_now at time zone 'UTC') + interval '1 month' - interval '1 day')::date;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':reconciliation-capacity:' || v_period_start::text || ':' || v_period_end::text,
      0
    )
  );

  select r.id into v_existing_run_id
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id
    and r.run_key = p_run_key
    and r.engine_version = p_engine_version;

  select reservation.* into v_existing_reservation
  from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = p_workspace_id
    and reservation.run_key = p_run_key
    and reservation.engine_version = p_engine_version
  for update;
  v_has_existing_reservation := found;

  select coalesce(sum(usage.quantity), 0) into v_recorded_usage
  from public.usage_records usage
  where usage.organization_id = v_organization_id
    and usage.metric_code = 'payments_processed'
    and usage.period_start <= v_period_end
    and usage.period_end >= v_period_start;

  select coalesce(sum(reservation.payment_count), 0) into v_pending_usage
  from public.reconciliation_usage_reservations reservation
  where reservation.organization_id = v_organization_id
    and reservation.period_start = v_period_start
    and reservation.period_end = v_period_end
    and (not v_has_existing_reservation or reservation.id <> v_existing_reservation.id)
    and (
      (reservation.status = 'reserved' and reservation.expires_at > v_now)
      or (
        reservation.status = 'committed'
        and not exists (
          select 1
          from public.usage_records committed_usage
          where committed_usage.organization_id = reservation.organization_id
            and committed_usage.source_event_id =
              'reconciliation-run:' || reservation.reconciliation_run_id::text || ':payments'
        )
      )
    );
  v_used := v_recorded_usage + v_pending_usage;

  if v_existing_run_id is not null then
    return jsonb_build_object(
      'allowed', true,
      'code', 'already_processed',
      'plan', v_plan_code,
      'limit', v_payment_limit,
      'used', v_used,
      'requested', p_payment_count,
      'remaining', greatest(v_payment_limit - v_used, 0),
      'period_start', to_char(v_period_start, 'YYYY-MM-DD'),
      'period_end', to_char(v_period_end, 'YYYY-MM-DD'),
      'existing', true
    );
  end if;

  if v_has_existing_reservation
     and v_existing_reservation.status = 'reserved'
     and v_existing_reservation.expires_at > v_now
     and v_existing_reservation.period_start = v_period_start
     and v_existing_reservation.period_end = v_period_end then
    if v_existing_reservation.payment_count <> p_payment_count then
      if v_used + p_payment_count > v_payment_limit then
        return jsonb_build_object(
          'allowed', false,
          'code', 'payment_limit_exceeded',
          'plan', v_plan_code,
          'limit', v_payment_limit,
          'used', v_used,
          'requested', p_payment_count,
          'remaining', greatest(v_payment_limit - v_used, 0),
          'period_start', to_char(v_period_start, 'YYYY-MM-DD'),
          'period_end', to_char(v_period_end, 'YYYY-MM-DD'),
          'existing', true
        );
      end if;
      update public.reconciliation_usage_reservations
      set payment_count = p_payment_count,
          expires_at = v_now + interval '15 minutes'
      where id = v_existing_reservation.id;
    end if;
    return jsonb_build_object(
      'allowed', true,
      'code', 'already_reserved',
      'plan', v_plan_code,
      'limit', v_payment_limit,
      'used', v_used,
      'requested', p_payment_count,
      'remaining', greatest(v_payment_limit - v_used - p_payment_count, 0),
      'period_start', to_char(v_period_start, 'YYYY-MM-DD'),
      'period_end', to_char(v_period_end, 'YYYY-MM-DD'),
      'existing', true,
      'reservation_id', v_existing_reservation.id
    );
  end if;

  if v_used + p_payment_count > v_payment_limit then
    return jsonb_build_object(
      'allowed', false,
      'code', 'payment_limit_exceeded',
      'plan', v_plan_code,
      'limit', v_payment_limit,
      'used', v_used,
      'requested', p_payment_count,
      'remaining', greatest(v_payment_limit - v_used, 0),
      'period_start', to_char(v_period_start, 'YYYY-MM-DD'),
      'period_end', to_char(v_period_end, 'YYYY-MM-DD'),
      'existing', false
    );
  end if;

  insert into public.reconciliation_usage_reservations (
    organization_id,
    workspace_id,
    run_key,
    engine_version,
    period_start,
    period_end,
    plan_code,
    payment_count,
    status,
    reconciliation_run_id,
    reserved_by,
    expires_at
  ) values (
    v_organization_id,
    p_workspace_id,
    p_run_key,
    p_engine_version,
    v_period_start,
    v_period_end,
    v_plan_code,
    p_payment_count,
    'reserved',
    null,
    v_actor,
    v_now + interval '15 minutes'
  )
  on conflict (workspace_id, run_key, engine_version) do update set
    organization_id = excluded.organization_id,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    plan_code = excluded.plan_code,
    payment_count = excluded.payment_count,
    status = 'reserved',
    reconciliation_run_id = null,
    reserved_by = excluded.reserved_by,
    expires_at = excluded.expires_at
  returning id into v_reservation_id;

  return jsonb_build_object(
    'allowed', true,
    'code', 'allowed',
    'plan', v_plan_code,
    'limit', v_payment_limit,
    'used', v_used,
    'requested', p_payment_count,
    'remaining', greatest(v_payment_limit - v_used - p_payment_count, 0),
    'period_start', to_char(v_period_start, 'YYYY-MM-DD'),
    'period_end', to_char(v_period_end, 'YYYY-MM-DD'),
    'existing', false,
    'reservation_id', v_reservation_id
  );
end;
$$;

create or replace function public.enqueue_async_reconciliation(
  p_workspace_id uuid,
  p_invoice_source_id uuid,
  p_payment_source_id uuid,
  p_invoice_mapping jsonb,
  p_payment_mapping jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.import_source_uploads%rowtype;
  v_payment public.import_source_uploads%rowtype;
  v_existing public.async_reconciliation_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_plan_code text := 'free';
  v_plan_limit integer := 20;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_idempotency_key is null
     or jsonb_typeof(p_invoice_mapping) is distinct from 'object'
     or jsonb_typeof(p_payment_mapping) is distinct from 'object'
     or octet_length(p_invoice_mapping::text) > 65536
     or octet_length(p_payment_mapping::text) > 65536 then
    raise exception using errcode = '22023', message = 'The reconciliation request is invalid';
  end if;
  select * into v_existing from public.async_reconciliation_requests r
  where r.submitted_by = v_actor and r.workspace_id = p_workspace_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.invoice_source_id <> p_invoice_source_id
       or v_existing.payment_source_id <> p_payment_source_id
       or v_existing.invoice_mapping <> p_invoice_mapping
       or v_existing.payment_mapping <> p_payment_mapping then
      raise exception using errcode = '22023', message = 'The request idempotency key was reused with different inputs';
    end if;
    return jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'existing', true, 'allowed', true);
  end if;

  select * into v_invoice from public.import_source_uploads s
  where s.id = p_invoice_source_id and s.workspace_id = p_workspace_id
    and s.created_by = v_actor for update;
  select * into v_payment from public.import_source_uploads s
  where s.id = p_payment_source_id and s.workspace_id = p_workspace_id
    and s.created_by = v_actor for update;
  if v_invoice.id is null or v_payment.id is null
     or v_invoice.organization_id <> v_payment.organization_id
     or v_invoice.import_kind <> 'invoice' or v_payment.import_kind <> 'payment'
     or v_invoice.status <> 'preview_ready' or v_payment.status <> 'preview_ready' then
    raise exception using errcode = '42501', message = 'Both validated sources are required';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = p_workspace_id and w.organization_id = v_invoice.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if not (p_invoice_mapping ?& array['invoiceNumber','customerName','invoiceDate','originalAmount'])
     or not (p_payment_mapping ?& array['paymentDate','amount'])
     or exists (select 1 from jsonb_object_keys(p_invoice_mapping) as keys(key)
       where keys.key <> all(array['invoiceNumber','customerName','customerId','customerEmail','invoiceDate','dueDate','originalAmount','outstandingBalance','currency','status','reference','purchaseOrder','memo','accountId']))
     or exists (select 1 from jsonb_object_keys(p_payment_mapping) as keys(key)
       where keys.key <> all(array['paymentDate','amount','currency','payerName','payerId','description','bankReference','achId','wireId','memo','transactionId','accountId']))
     or exists (select 1 from jsonb_each_text(p_invoice_mapping) entry where not (v_invoice.source_headers ? entry.value))
     or exists (select 1 from jsonb_each_text(p_payment_mapping) entry where not (v_payment.source_headers ? entry.value)) then
    raise exception using errcode = '22023', message = 'Every required mapping must reference a discovered source header';
  end if;

  select s.plan_code into v_plan_code from public.subscriptions s
  where s.organization_id = v_invoice.organization_id
    and s.status in ('active', 'trialing', 'past_due');
  v_plan_code := coalesce(v_plan_code, 'free');
  v_plan_limit := app_private.monthly_payment_limit(v_plan_code);
  if coalesce(v_payment.row_count, 0) > v_plan_limit then
    return jsonb_build_object(
      'allowed', false, 'code', 'payment_limit_exceeded', 'plan', v_plan_code,
      'limit', v_plan_limit, 'requested', v_payment.row_count
    );
  end if;

  insert into public.async_reconciliation_requests (
    id, organization_id, workspace_id, submitted_by, invoice_source_id,
    payment_source_id, invoice_mapping, payment_mapping, idempotency_key
  ) values (
    v_request_id, v_invoice.organization_id, p_workspace_id, v_actor,
    v_invoice.id, v_payment.id, p_invoice_mapping, p_payment_mapping, p_idempotency_key
  );
  update public.import_source_uploads set status = 'reconciling', progress_label = 'Queued for reconciliation'
  where id in (v_invoice.id, v_payment.id);
  insert into public.background_jobs (
    organization_id, workspace_id, job_type, status, idempotency_key,
    queue_name, max_attempts, payload_reference, progress_current, progress_total
  ) values (
    v_invoice.organization_id, p_workspace_id, 'run_matching', 'queued',
    'async-reconciliation:' || v_request_id::text, 'large-imports', 4,
    'async-reconciliation:' || v_request_id::text, 0, 100
  );
  return jsonb_build_object('request_id', v_request_id, 'status', 'queued', 'existing', false, 'allowed', true);
end;
$$;

create or replace function public.worker_claim_async_reconciliation(p_request_id uuid, p_step_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
  v_invoice public.import_source_uploads%rowtype;
  v_payment public.import_source_uploads%rowtype;
  v_token text;
  v_plan_code text := 'free';
  v_plan_limit integer := 20;
begin
  perform app_private.require_service_role();
  if p_step_id is null or char_length(p_step_id) not between 8 and 300 then
    raise exception using errcode = '22023', message = 'The worker step identifier is invalid';
  end if;
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = '22023', message = 'The reconciliation request does not exist'; end if;
  if v_request.status = 'succeeded' then
    return jsonb_build_object('status', 'already_completed', 'summary', v_request.result_summary);
  end if;
  if v_request.status not in ('queued', 'processing') then
    raise exception using errcode = '22023', message = 'The reconciliation request cannot be processed';
  end if;
  if v_request.status = 'processing'
     and v_request.worker_step_id is distinct from p_step_id
     and v_request.worker_claim_expires_at > statement_timestamp() then
    raise exception using errcode = '40001', message = 'Another worker owns this reconciliation request';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_request.submitted_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_request.workspace_id and w.organization_id = v_request.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The submitting member no longer has workspace access';
  end if;
  select * into strict v_invoice from public.import_source_uploads where id = v_request.invoice_source_id;
  select * into strict v_payment from public.import_source_uploads where id = v_request.payment_source_id;
  if v_invoice.storage_path = '' or v_payment.storage_path = ''
     or v_invoice.status not in ('reconciling', 'completed')
     or v_payment.status not in ('reconciling', 'completed') then
    raise exception using errcode = '22023', message = 'The bound import sources are unavailable';
  end if;
  select s.plan_code into v_plan_code from public.subscriptions s
  where s.organization_id = v_request.organization_id
    and s.status in ('active', 'trialing', 'past_due');
  v_plan_code := coalesce(v_plan_code, 'free');
  v_plan_limit := app_private.monthly_payment_limit(v_plan_code);
  if v_payment.row_count is null or v_payment.row_count > v_plan_limit then
    update public.async_reconciliation_requests
    set status = 'failed', progress_label = 'Plan capacity changed',
        completed_at = statement_timestamp(),
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = 'payment_limit_exceeded',
        error_message = 'The current plan no longer permits this source volume.'
    where id = v_request.id;
    update public.import_source_uploads set status = 'preview_ready', progress_label = 'Ready to map'
    where id in (v_request.invoice_source_id, v_request.payment_source_id);
    update public.background_jobs
    set status = 'failed', completed_at = statement_timestamp(),
        error_code = 'payment_limit_exceeded', error_summary = 'The current plan capacity changed before processing.',
        locked_at = null, locked_by = null
    where organization_id = v_request.organization_id
      and idempotency_key = 'async-reconciliation:' || v_request.id::text;
    insert into public.user_notifications (
      user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
    ) values (
      v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
      'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
      'Your plan was rechecked before processing, and this source no longer fits the current allowance.',
      '/app/' || v_request.workspace_id::text || '/imports'
    ) on conflict (user_id, event_type, entity_id) do update
      set body = excluded.body, read_at = null, created_at = statement_timestamp();
    return jsonb_build_object(
      'status', 'plan_capacity_rejected', 'request_id', v_request.id,
      'workspace_id', v_request.workspace_id, 'submitted_by', v_request.submitted_by
    );
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.async_reconciliation_requests
  set status = 'processing', started_at = coalesce(started_at, statement_timestamp()),
      worker_step_id = p_step_id, worker_claim_hash = app_private.worker_token_hash(v_token),
      worker_claim_expires_at = statement_timestamp() + interval '2 hours',
      progress_current = 10, progress_label = 'Validating source files'
  where id = v_request.id;
  update public.background_jobs
  set status = 'running', attempts = least(attempts + 1, max_attempts),
      started_at = coalesce(started_at, statement_timestamp()), progress_current = 10,
      locked_at = statement_timestamp(), locked_by = left(p_step_id, 200)
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  return jsonb_build_object(
    'status', 'claimed', 'worker_token', v_token,
    'request_id', v_request.id, 'organization_id', v_request.organization_id,
    'workspace_id', v_request.workspace_id, 'submitted_by', v_request.submitted_by,
    'invoice_mapping', v_request.invoice_mapping, 'payment_mapping', v_request.payment_mapping,
    'invoice_source', jsonb_build_object(
      'id', v_invoice.id, 'source_type', v_invoice.source_type,
      'expected_byte_size', v_invoice.expected_byte_size, 'expected_sha256', v_invoice.expected_sha256,
      'storage_bucket', v_invoice.storage_bucket, 'storage_path', v_invoice.storage_path,
      'selected_sheet', v_invoice.selected_sheet
    ),
    'payment_source', jsonb_build_object(
      'id', v_payment.id, 'source_type', v_payment.source_type,
      'expected_byte_size', v_payment.expected_byte_size, 'expected_sha256', v_payment.expected_sha256,
      'storage_bucket', v_payment.storage_bucket, 'storage_path', v_payment.storage_path,
      'selected_sheet', v_payment.selected_sheet
    )
  );
end;
$$;

create or replace function public.worker_complete_async_reconciliation(
  p_request_id uuid,
  p_step_id text,
  p_worker_token text,
  p_run_key text,
  p_engine_version text,
  p_billable_payment_count bigint,
  p_snapshot jsonb,
  p_invoice_import jsonb,
  p_payment_import jsonb,
  p_safe_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan_code text := 'free';
  v_limit bigint := 20;
  v_period_start date;
  v_period_end date;
  v_recorded bigint := 0;
  v_pending bigint := 0;
  v_existing_run_id uuid;
  v_existing_reservation public.reconciliation_usage_reservations%rowtype;
  v_result jsonb;
  v_now timestamptz := statement_timestamp();
begin
  perform app_private.require_service_role();
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = '22023', message = 'The reconciliation request does not exist'; end if;
  if v_request.status = 'succeeded' then
    return jsonb_build_object('allowed', true, 'status', 'succeeded', 'summary', v_request.result_summary, 'existing', true);
  end if;
  if v_request.status <> 'processing'
     or v_request.worker_step_id is distinct from p_step_id
     or v_request.worker_claim_expires_at <= v_now
     or v_request.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The reconciliation worker claim is invalid';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_request.submitted_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_request.workspace_id and w.organization_id = v_request.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The submitting member no longer has workspace access';
  end if;
  if p_billable_payment_count not between 0 and 50000
     or jsonb_typeof(p_safe_summary) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_safe_summary) as keys(key)
       where keys.key <> all(array['invoices','payments','matches','review','issues']))
     or not (p_safe_summary ?& array['invoices','payments','matches','review','issues'])
     or exists (select 1 from jsonb_each_text(p_safe_summary) entry where entry.value !~ '^[0-9]+$')
     or octet_length(p_safe_summary::text) > 4096 then
    raise exception using errcode = '22023', message = 'The reconciliation completion summary is invalid';
  end if;

  select * into v_subscription from public.subscriptions s
  where s.organization_id = v_request.organization_id;
  if found and v_subscription.status in ('active', 'trialing', 'past_due') then
    v_plan_code := v_subscription.plan_code;
  end if;
  v_limit := app_private.monthly_payment_limit(v_plan_code);
  if v_plan_code <> 'free'
     and v_subscription.current_period_starts_at is not null
     and v_subscription.current_period_ends_at is not null
     and v_now >= v_subscription.current_period_starts_at
     and v_now < v_subscription.current_period_ends_at then
    v_period_start := (v_subscription.current_period_starts_at at time zone 'UTC')::date;
    v_period_end := ((v_subscription.current_period_ends_at - interval '1 microsecond') at time zone 'UTC')::date;
  else
    v_period_start := date_trunc('month', v_now at time zone 'UTC')::date;
    v_period_end := (date_trunc('month', v_now at time zone 'UTC') + interval '1 month' - interval '1 day')::date;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_request.organization_id::text || ':reconciliation-capacity:' || v_period_start::text || ':' || v_period_end::text, 0
  ));
  select r.id into v_existing_run_id from public.reconciliation_runs r
  where r.workspace_id = v_request.workspace_id and r.run_key = p_run_key and r.engine_version = p_engine_version;
  select * into v_existing_reservation from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = v_request.workspace_id
    and reservation.run_key = p_run_key and reservation.engine_version = p_engine_version for update;
  select coalesce(sum(u.quantity), 0) into v_recorded from public.usage_records u
  where u.organization_id = v_request.organization_id and u.metric_code = 'payments_processed'
    and u.period_start <= v_period_end and u.period_end >= v_period_start;
  select coalesce(sum(reservation.payment_count), 0) into v_pending
  from public.reconciliation_usage_reservations reservation
  where reservation.organization_id = v_request.organization_id
    and reservation.period_start = v_period_start and reservation.period_end = v_period_end
    and (v_existing_reservation.id is null or reservation.id <> v_existing_reservation.id)
    and ((reservation.status = 'reserved' and reservation.expires_at > v_now)
      or (reservation.status = 'committed' and not exists (
        select 1 from public.usage_records u where u.organization_id = reservation.organization_id
          and u.source_event_id = 'reconciliation-run:' || reservation.reconciliation_run_id::text || ':payments'
      )));
  if v_existing_run_id is null and v_recorded + v_pending + p_billable_payment_count > v_limit then
    update public.async_reconciliation_requests
    set status = 'failed', progress_label = 'Plan capacity reached', completed_at = v_now,
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = 'payment_limit_exceeded', error_message = 'This run exceeds the current payment processing allowance.'
    where id = v_request.id;
    update public.import_source_uploads set status = 'preview_ready', progress_label = 'Ready to map'
    where id in (v_request.invoice_source_id, v_request.payment_source_id);
    update public.background_jobs set status = 'failed', completed_at = v_now,
      error_code = 'payment_limit_exceeded', error_summary = 'The current plan capacity was reached.',
      locked_at = null, locked_by = null
    where organization_id = v_request.organization_id
      and idempotency_key = 'async-reconciliation:' || v_request.id::text;
    insert into public.user_notifications (
      user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
    ) values (
      v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
      'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
      'Your payment processing allowance was rechecked before saving, and this run does not fit the current plan.',
      '/app/' || v_request.workspace_id::text || '/imports'
    ) on conflict (user_id, event_type, entity_id) do update
      set body = excluded.body, read_at = null, created_at = v_now;
    return jsonb_build_object(
      'allowed', false, 'status', 'failed', 'code', 'payment_limit_exceeded',
      'plan', v_plan_code, 'limit', v_limit, 'used', v_recorded + v_pending,
      'requested', p_billable_payment_count
    );
  end if;

  if v_existing_run_id is null then
    insert into public.reconciliation_usage_reservations (
      organization_id, workspace_id, run_key, engine_version, period_start, period_end,
      plan_code, payment_count, status, reserved_by, expires_at
    ) values (
      v_request.organization_id, v_request.workspace_id, p_run_key, p_engine_version,
      v_period_start, v_period_end, v_plan_code, p_billable_payment_count,
      'reserved', v_request.submitted_by, v_now + interval '2 hours'
    ) on conflict (workspace_id, run_key, engine_version) do update set
      organization_id = excluded.organization_id, period_start = excluded.period_start,
      period_end = excluded.period_end, plan_code = excluded.plan_code,
      payment_count = excluded.payment_count, status = 'reserved',
      reconciliation_run_id = null, reserved_by = excluded.reserved_by,
      expires_at = excluded.expires_at;
  end if;

  perform set_config('app.async_request_id', v_request.id::text, true);
  perform set_config('app.async_step_id', p_step_id, true);
  perform set_config('app.async_worker_token', p_worker_token, true);
  if not app_private.async_worker_context_is_valid(v_request.workspace_id) then
    raise exception using errcode = '42501', message = 'The reconciliation worker context is invalid';
  end if;
  v_result := public.persist_reconciliation_run_v2(
    v_request.workspace_id, p_run_key, p_engine_version,
    p_snapshot, p_invoice_import, p_payment_import
  );
  delete from public.reconciliation_run_read_items i
  where i.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid;

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'invoice', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'invoiceNumber', source.value ->> 'customerName', source.value ->> 'reference')), 2000),
    source.value ->> 'status'
  from jsonb_array_elements(coalesce(p_snapshot -> 'invoices', '[]'::jsonb)) with ordinality as source(value, ordinality);

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'payment', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'payerName', source.value ->> 'description', source.value ->> 'transactionId', source.value ->> 'bankReference')), 2000),
    null
  from jsonb_array_elements(coalesce(p_snapshot -> 'payments', '[]'::jsonb)) with ordinality as source(value, ordinality);

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'match', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'method', payment_terms.search_text, invoice_terms.search_text)), 2000),
    source.value ->> 'confidence'
  from jsonb_array_elements(coalesce(p_snapshot #> '{result,matches}', '[]'::jsonb)) with ordinality as source(value, ordinality)
  left join lateral (
    select string_agg(item.search_text, ' ' order by item.ordinal) as search_text
    from jsonb_array_elements_text(coalesce(source.value -> 'paymentIds', '[]'::jsonb)) as id(value)
    join public.reconciliation_run_read_items item
      on item.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid
      and item.item_type = 'payment' and item.item_id = id.value
  ) payment_terms on true
  left join lateral (
    select string_agg(item.search_text, ' ' order by item.ordinal) as search_text
    from jsonb_array_elements_text(coalesce(source.value -> 'invoiceIds', '[]'::jsonb)) as id(value)
    join public.reconciliation_run_read_items item
      on item.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid
      and item.item_type = 'invoice' and item.item_id = id.value
  ) invoice_terms on true;

  update public.async_reconciliation_requests
  set status = 'succeeded', progress_current = 100, progress_label = 'Reconciliation ready',
      run_record_id = (v_result ->> 'run_record_id')::uuid, run_key = p_run_key,
      result_summary = p_safe_summary, completed_at = v_now,
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = null, error_message = null
  where id = v_request.id;
  update public.import_source_uploads set status = 'completed', progress_label = 'Reconciliation saved'
  where id in (v_request.invoice_source_id, v_request.payment_source_id);
  update public.background_jobs
  set status = 'succeeded', progress_current = 100, completed_at = v_now,
      locked_at = null, locked_by = null, error_code = null, error_summary = null
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  insert into public.user_notifications (
    user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
  ) values (
    v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
    'reconciliation_ready', v_request.id, 'Reconciliation ready',
    'Your background reconciliation is saved and ready for review.',
    '/app/' || v_request.workspace_id::text || '/exceptions'
  ) on conflict (user_id, event_type, entity_id) do update
    set body = excluded.body, read_at = null, created_at = v_now;
  return jsonb_build_object(
    'allowed', true, 'status', 'succeeded', 'existing', coalesce((v_result ->> 'existing')::boolean, false),
    'run_record_id', v_result ->> 'run_record_id', 'saved_at', v_result ->> 'saved_at',
    'summary', p_safe_summary
  );
end;
$$;

-- CREATE OR REPLACE retains existing caller grants, ownership and security
-- boundaries. The private policy is callable only through these checked RPCs.
commit;
