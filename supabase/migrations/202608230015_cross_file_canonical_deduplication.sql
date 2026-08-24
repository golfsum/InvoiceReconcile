begin;

-- Canonical identities are recomputed in PostgreSQL. Client-supplied IDs remain
-- source-row identifiers only and cannot bypass workspace-wide deduplication.
create or replace function app_private.normalize_record_reference(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function app_private.normalize_record_name(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_token text;
  v_tokens text[] := '{}'::text[];
begin
  foreach v_token in array regexp_split_to_array(
    upper(regexp_replace(replace(coalesce(p_value, ''), '&', ' AND '), '[^A-Za-z0-9]+', ' ', 'g')),
    '[[:space:]]+'
  ) loop
    if v_token <> '' and v_token <> all(array[
      'CO', 'COMPANY', 'CORP', 'CORPORATION', 'INC', 'INCORPORATED',
      'LLC', 'LLP', 'LP', 'LTD', 'LIMITED', 'PLC', 'ACH', 'CREDIT',
      'DEPOSIT', 'ORIG', 'ORIGINATOR', 'PAYMENT', 'PMT', 'RECEIVED',
      'TRANSFER', 'WIRE'
    ]) then
      v_tokens := array_append(v_tokens, v_token);
    end if;
  end loop;
  return array_to_string(v_tokens, ' ');
end;
$$;

create or replace function app_private.invoice_record_identity(p_invoice jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'invoice:'
    || app_private.normalize_record_reference(p_invoice ->> 'invoiceNumber') || ':'
    || app_private.normalize_record_name(p_invoice ->> 'customerName') || ':'
    || upper(coalesce(p_invoice ->> 'currency', '')) || ':'
    || coalesce(p_invoice ->> 'originalAmountMinor', '') || ':'
    || app_private.normalize_record_reference(p_invoice ->> 'accountId');
$$;

create or replace function app_private.payment_record_identity(p_payment jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_transaction text := app_private.normalize_record_reference(p_payment ->> 'transactionId');
  v_account text := app_private.normalize_record_reference(p_payment ->> 'accountId');
  v_reference text;
begin
  if v_transaction <> '' then
    return 'payment:transaction:' || v_account || ':' || v_transaction;
  end if;
  v_reference := app_private.normalize_record_reference(coalesce(
    nullif(p_payment ->> 'bankReference', ''),
    nullif(p_payment ->> 'achId', ''),
    nullif(p_payment ->> 'wireId', ''),
    p_payment ->> 'description'
  ));
  return 'payment:fingerprint:'
    || coalesce(p_payment ->> 'paymentDate', '') || ':'
    || coalesce(p_payment ->> 'amountMinor', '') || ':'
    || upper(coalesce(p_payment ->> 'currency', '')) || ':'
    || v_account || ':'
    || v_reference || ':'
    || app_private.normalize_record_name(p_payment ->> 'payerName');
end;
$$;

create or replace function app_private.record_identity_hash(p_identity text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(p_identity, 'sha256'), 'hex');
$$;

revoke all on function app_private.normalize_record_reference(text) from public;
revoke all on function app_private.normalize_record_name(text) from public;
revoke all on function app_private.invoice_record_identity(jsonb) from public;
revoke all on function app_private.payment_record_identity(jsonb) from public;
revoke all on function app_private.record_identity_hash(text) from public;

-- Rank pre-migration duplicates conservatively. The record with the most
-- applied financial state wins; every other row remains as a duplicate record
-- with its import and historical match links intact.
with candidates as (
  select
    i.id,
    i.workspace_id,
    app_private.record_identity_hash(app_private.invoice_record_identity(jsonb_build_object(
      'invoiceNumber', i.invoice_number,
      'customerName', coalesce(nullif(i.raw_source ->> 'customer_name', ''), c.name, ''),
      'currency', i.currency_code,
      'originalAmountMinor', i.original_amount_minor,
      'accountId', i.raw_source ->> 'account_id'
    ))) as identity_key,
    first_value(i.id) over (
      partition by i.workspace_id, app_private.record_identity_hash(app_private.invoice_record_identity(jsonb_build_object(
        'invoiceNumber', i.invoice_number,
        'customerName', coalesce(nullif(i.raw_source ->> 'customer_name', ''), c.name, ''),
        'currency', i.currency_code,
        'originalAmountMinor', i.original_amount_minor,
        'accountId', i.raw_source ->> 'account_id'
      )))
      order by i.outstanding_balance_minor, i.created_at, i.id
    ) as canonical_id
  from public.invoices i
  left join public.customers c on c.id = i.customer_id and c.workspace_id = i.workspace_id
  where i.duplicate_of_id is null
), duplicates as (
  select * from candidates where id <> canonical_id
)
update public.invoices i
set duplicate_of_id = d.canonical_id,
    status = 'duplicate'
from duplicates d
where i.id = d.id and i.workspace_id = d.workspace_id;

with candidates as (
  select
    p.id,
    p.workspace_id,
    first_value(p.id) over (
      partition by p.workspace_id, app_private.record_identity_hash(app_private.payment_record_identity(jsonb_build_object(
        'transactionId', nullif(p.raw_source ->> 'transaction_id', ''),
        'paymentDate', p.transaction_date,
        'amountMinor', p.amount_minor,
        'currency', p.currency_code,
        'bankReference', p.bank_reference,
        'achId', p.ach_id,
        'wireId', p.wire_id,
        'description', p.description,
        'payerName', p.payer_name,
        'accountId', p.account_reference
      )))
      order by p.unapplied_amount_minor, p.created_at, p.id
    ) as canonical_id
  from public.payments p
  where p.duplicate_of_id is null
), duplicates as (
  select * from candidates where id <> canonical_id
)
update public.payments p
set duplicate_of_id = d.canonical_id,
    status = 'duplicate'
from duplicates d
where p.id = d.id and p.workspace_id = d.workspace_id;

-- Suggested matches remain actionable after backfill by pointing their ledger
-- links at the canonical rows. Approved/rejected history is left untouched.
insert into public.audit_events (
  organization_id, workspace_id, actor_user_id, actor_type,
  event_type, entity_type, entity_id, source_import_id, metadata
)
select distinct
  w.organization_id,
  m.workspace_id,
  null,
  'system',
  'reconciliation_match.canonicalized',
  'match',
  m.id,
  r.payment_import_id,
  jsonb_build_object(
    'reason', 'Cross-file duplicate records were remapped to their workspace canonical rows.',
    'duplicate_payment_links', (
      select count(*)
      from public.match_payment_links payment_link
      join public.payments duplicate_payment
        on duplicate_payment.id = payment_link.payment_id
        and duplicate_payment.workspace_id = payment_link.workspace_id
      where payment_link.match_id = m.id and duplicate_payment.duplicate_of_id is not null
    ),
    'duplicate_invoice_links', (
      select count(*)
      from public.match_invoice_links invoice_link
      join public.invoices duplicate_invoice
        on duplicate_invoice.id = invoice_link.invoice_id
        and duplicate_invoice.workspace_id = invoice_link.workspace_id
      where invoice_link.match_id = m.id and duplicate_invoice.duplicate_of_id is not null
    )
  )
from public.matches m
join public.workspaces w on w.id = m.workspace_id
left join public.reconciliation_runs r
  on r.id = m.reconciliation_run_id and r.workspace_id = m.workspace_id
where m.status = 'suggested'
  and (
    exists (
      select 1
      from public.match_payment_links payment_link
      join public.payments duplicate_payment
        on duplicate_payment.id = payment_link.payment_id
        and duplicate_payment.workspace_id = payment_link.workspace_id
      where payment_link.match_id = m.id and duplicate_payment.duplicate_of_id is not null
    )
    or exists (
      select 1
      from public.match_invoice_links invoice_link
      join public.invoices duplicate_invoice
        on duplicate_invoice.id = invoice_link.invoice_id
        and duplicate_invoice.workspace_id = invoice_link.workspace_id
      where invoice_link.match_id = m.id and duplicate_invoice.duplicate_of_id is not null
    )
  );

delete from public.match_payment_links link
using public.payments duplicate_payment, public.matches m
where link.payment_id = duplicate_payment.id
  and link.workspace_id = duplicate_payment.workspace_id
  and duplicate_payment.duplicate_of_id is not null
  and m.id = link.match_id
  and m.workspace_id = link.workspace_id
  and m.status = 'suggested'
  and exists (
    select 1 from public.match_payment_links canonical_link
    where canonical_link.match_id = link.match_id
      and canonical_link.payment_id = duplicate_payment.duplicate_of_id
  );

update public.match_payment_links link
set payment_id = duplicate_payment.duplicate_of_id
from public.payments duplicate_payment, public.matches m
where link.payment_id = duplicate_payment.id
  and link.workspace_id = duplicate_payment.workspace_id
  and duplicate_payment.duplicate_of_id is not null
  and m.id = link.match_id
  and m.workspace_id = link.workspace_id
  and m.status = 'suggested';

update public.matches m
set payment_id = duplicate_payment.duplicate_of_id
from public.payments duplicate_payment
where m.payment_id = duplicate_payment.id
  and m.workspace_id = duplicate_payment.workspace_id
  and duplicate_payment.duplicate_of_id is not null
  and m.status = 'suggested';

delete from public.match_invoice_links link
using public.invoices duplicate_invoice, public.matches m
where link.invoice_id = duplicate_invoice.id
  and link.workspace_id = duplicate_invoice.workspace_id
  and duplicate_invoice.duplicate_of_id is not null
  and m.id = link.match_id
  and m.workspace_id = link.workspace_id
  and m.status = 'suggested'
  and exists (
    select 1 from public.match_invoice_links canonical_link
    where canonical_link.match_id = link.match_id
      and canonical_link.invoice_id = duplicate_invoice.duplicate_of_id
  );

update public.match_invoice_links link
set invoice_id = duplicate_invoice.duplicate_of_id
from public.invoices duplicate_invoice, public.matches m
where link.invoice_id = duplicate_invoice.id
  and link.workspace_id = duplicate_invoice.workspace_id
  and duplicate_invoice.duplicate_of_id is not null
  and m.id = link.match_id
  and m.workspace_id = link.workspace_id
  and m.status = 'suggested';

update public.invoices i
set external_id = coalesce(i.external_id, 'file:invoice:' || identity.identity_key),
    dedupe_key = identity.identity_key
from (
  select
    source.id,
    app_private.record_identity_hash(app_private.invoice_record_identity(jsonb_build_object(
      'invoiceNumber', source.invoice_number,
      'customerName', coalesce(nullif(source.raw_source ->> 'customer_name', ''), c.name, ''),
      'currency', source.currency_code,
      'originalAmountMinor', source.original_amount_minor,
      'accountId', source.raw_source ->> 'account_id'
    ))) as identity_key
  from public.invoices source
  left join public.customers c on c.id = source.customer_id and c.workspace_id = source.workspace_id
) identity
where i.id = identity.id;

update public.payments p
set external_id = coalesce(
      p.external_id,
      'file:payment:' || identity.identity_key
    ),
    dedupe_key = identity.identity_key
from (
  select
    source.id,
    app_private.record_identity_hash(app_private.payment_record_identity(jsonb_build_object(
      'transactionId', nullif(source.raw_source ->> 'transaction_id', ''),
      'paymentDate', source.transaction_date,
      'amountMinor', source.amount_minor,
      'currency', source.currency_code,
      'bankReference', source.bank_reference,
      'achId', source.ach_id,
      'wireId', source.wire_id,
      'description', source.description,
      'payerName', source.payer_name,
      'accountId', source.account_reference
    ))) as identity_key
  from public.payments source
) identity
where p.id = identity.id;

update public.import_rows r
set canonical_record_id = coalesce(i.duplicate_of_id, i.id),
    dedupe_hash = i.dedupe_key,
    disposition = case when i.duplicate_of_id is null then 'accepted' else 'duplicate' end,
    issue_codes = case
      when i.duplicate_of_id is not null and not (r.issue_codes ? 'duplicate_across_imports')
        then r.issue_codes || '["duplicate_across_imports"]'::jsonb
      else r.issue_codes
    end
from public.invoices i
where r.id = i.import_row_id and r.workspace_id = i.workspace_id;

update public.import_rows r
set canonical_record_id = coalesce(p.duplicate_of_id, p.id),
    dedupe_hash = p.dedupe_key,
    disposition = case when p.duplicate_of_id is null then 'accepted' else 'duplicate' end,
    issue_codes = case
      when p.duplicate_of_id is not null and not (r.issue_codes ? 'duplicate_across_imports')
        then r.issue_codes || '["duplicate_across_imports"]'::jsonb
      else r.issue_codes
    end
from public.payments p
where r.id = p.import_row_id and r.workspace_id = p.workspace_id;

update public.imports i
set accepted_rows = counts.accepted_rows,
    rejected_rows = counts.rejected_rows,
    duplicate_rows = counts.duplicate_rows,
    blank_rows = counts.blank_rows,
    status = case when counts.rejected_rows + counts.duplicate_rows > 0 then 'completed_with_errors' else 'completed' end
from (
  select
    r.import_id,
    count(*) filter (where r.disposition = 'accepted')::integer as accepted_rows,
    count(*) filter (where r.disposition = 'rejected')::integer as rejected_rows,
    count(*) filter (where r.disposition = 'duplicate')::integer as duplicate_rows,
    count(*) filter (where r.disposition = 'blank')::integer as blank_rows
  from public.import_rows r
  group by r.import_id
) counts
where i.id = counts.import_id
  and i.status in ('completed', 'completed_with_errors');

-- Migration 017 replaces these fail-closed hooks with request, step, token,
-- membership, and workspace validation for Workflow DevKit workers. Keeping
-- the hooks false/null here makes migration 015 safe if it is applied alone.
create or replace function app_private.async_worker_context_is_valid(target_workspace_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

create or replace function app_private.async_worker_actor(target_workspace_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$ select null::uuid $$;

revoke all on function app_private.async_worker_context_is_valid(uuid) from public, anon, authenticated;
revoke all on function app_private.async_worker_actor(uuid) from public, anon, authenticated;

create or replace function public.get_reconciliation_import_context(
  p_workspace_id uuid,
  p_invoices jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_async_worker boolean := auth.role() = 'service_role'
    and app_private.async_worker_context_is_valid(p_workspace_id);
  v_actor uuid := coalesce(auth.uid(), app_private.async_worker_actor(p_workspace_id));
  v_item jsonb;
  v_client_id text;
  v_identity_key text;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_effective_invoice_balance bigint;
  v_effective_invoice_status text;
  v_invoice_states jsonb := '[]'::jsonb;
  v_payment_states jsonb := '[]'::jsonb;
  v_seen_invoice_ids text[] := '{}'::text[];
  v_seen_payment_ids text[] := '{}'::text[];
begin
  if v_actor is null
     or not (auth.role() = 'authenticated' or v_async_worker) then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not v_async_worker and not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if jsonb_typeof(p_invoices) is distinct from 'array'
     or jsonb_typeof(p_payments) is distinct from 'array'
     or jsonb_array_length(p_invoices) > 50000
     or jsonb_array_length(p_payments) > 50000
     or octet_length(p_invoices::text) + octet_length(p_payments::text) > 52428800 then
    raise exception using errcode = '22023', message = 'The reconciliation import context is invalid';
  end if;

  for v_item in select value from jsonb_array_elements(p_invoices) loop
    v_client_id := nullif(btrim(v_item ->> 'id'), '');
    if v_client_id is null or char_length(v_client_id) > 1000 or v_client_id = any(v_seen_invoice_ids) then
      raise exception using errcode = '22023', message = 'Invoice source identifiers must be unique';
    end if;
    v_seen_invoice_ids := array_append(v_seen_invoice_ids, v_client_id);
    v_identity_key := app_private.record_identity_hash(app_private.invoice_record_identity(v_item));
    select i.* into v_invoice
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.duplicate_of_id is null
      and i.dedupe_key = v_identity_key
    limit 1;
    if found then
      v_effective_invoice_balance := least(
        v_invoice.outstanding_balance_minor,
        (v_item ->> 'outstandingAmountMinor')::bigint
      );
      v_effective_invoice_status := case
        when v_invoice.status = 'void' or v_item ->> 'status' = 'void' then 'void'
        when v_invoice.status = 'paid' or v_item ->> 'status' = 'paid' then 'paid'
        when v_effective_invoice_balance = 0 then 'paid'
        when v_effective_invoice_balance < v_invoice.original_amount_minor then 'partially_paid'
        else 'open'
      end;
      v_invoice_states := v_invoice_states || jsonb_build_array(jsonb_build_object(
        'client_id', v_client_id,
        'outstanding_amount_minor', v_effective_invoice_balance,
        'status', v_effective_invoice_status
      ));
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_payments) loop
    v_client_id := nullif(btrim(v_item ->> 'id'), '');
    if v_client_id is null or char_length(v_client_id) > 1000 or v_client_id = any(v_seen_payment_ids) then
      raise exception using errcode = '22023', message = 'Payment source identifiers must be unique';
    end if;
    v_seen_payment_ids := array_append(v_seen_payment_ids, v_client_id);
    v_identity_key := app_private.record_identity_hash(app_private.payment_record_identity(v_item));
    select p.* into v_payment
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.duplicate_of_id is null
      and p.dedupe_key = v_identity_key
    limit 1;
    if found then
      v_payment_states := v_payment_states || jsonb_build_array(jsonb_build_object(
        'client_id', v_client_id,
        'unapplied_amount_minor', v_payment.unapplied_amount_minor,
        'status', v_payment.status
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'invoice_states', v_invoice_states,
    'payment_states', v_payment_states
  );
end;
$$;

revoke all on function public.get_reconciliation_import_context(uuid, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.get_reconciliation_import_context(uuid, jsonb, jsonb)
to authenticated;

comment on function public.get_reconciliation_import_context(uuid, jsonb, jsonb) is
  'Returns current canonical invoice state and identifies previously imported payments before matching.';

-- A current run may carry a still-unapplied canonical payment forward so it
-- remains actionable in the latest review queue. Capacity is charged only for
-- payments first imported by this run, never for those carried records.
create or replace function app_private.require_reconciliation_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reconciliation_usage_reservations%rowtype;
  v_usage_payment_count bigint;
begin
  if jsonb_typeof(new.snapshot -> 'payments') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot has no payment list';
  end if;
  if new.snapshot ? 'usagePaymentCount' then
    if jsonb_typeof(new.snapshot -> 'usagePaymentCount') <> 'number'
       or new.snapshot ->> 'usagePaymentCount' !~ '^[0-9]+$' then
      raise exception using errcode = '22023', message = 'The reconciliation usage payment count is invalid';
    end if;
    v_usage_payment_count := (new.snapshot ->> 'usagePaymentCount')::bigint;
  else
    v_usage_payment_count := jsonb_array_length(new.snapshot -> 'payments');
  end if;
  if v_usage_payment_count < 0
     or v_usage_payment_count > jsonb_array_length(new.snapshot -> 'payments') then
    raise exception using errcode = '22023', message = 'The reconciliation usage payment count is invalid';
  end if;

  select reservation.* into v_reservation
  from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = new.workspace_id
    and reservation.run_key = new.run_key
    and reservation.engine_version = new.engine_version;
  if not found then
    raise exception using errcode = 'P0001', message = 'A valid reconciliation payment-capacity reservation is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_reservation.organization_id::text || ':reconciliation-capacity:'
        || v_reservation.period_start::text || ':' || v_reservation.period_end::text,
      0
    )
  );
  select reservation.* into v_reservation
  from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = new.workspace_id
    and reservation.run_key = new.run_key
    and reservation.engine_version = new.engine_version
  for update;
  if not found
     or v_reservation.status <> 'reserved'
     or v_reservation.expires_at <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'A valid reconciliation payment-capacity reservation is required';
  end if;
  if v_reservation.payment_count <> v_usage_payment_count then
    raise exception using errcode = '22023', message = 'The reconciliation payment count does not match its capacity reservation';
  end if;

  update public.reconciliation_usage_reservations
  set status = 'committed', reconciliation_run_id = new.id
  where id = v_reservation.id;
  return new;
end;
$$;

revoke all on function app_private.require_reconciliation_capacity() from public;

create or replace function public.persist_reconciliation_run_v2(
  p_workspace_id uuid,
  p_run_key text,
  p_engine_version text,
  p_snapshot jsonb,
  p_invoice_import jsonb,
  p_payment_import jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_async_worker boolean := auth.role() = 'service_role'
    and app_private.async_worker_context_is_valid(p_workspace_id);
  v_actor uuid := coalesce(auth.uid(), app_private.async_worker_actor(p_workspace_id));
  v_actor_type text := case when v_async_worker then 'system' else 'user' end;
  v_organization_id uuid;
  v_existing public.reconciliation_runs%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_saved_at timestamptz;
  v_invoice_import_id uuid;
  v_payment_import_id uuid;
  v_invoice_import_is_new boolean := false;
  v_payment_import_is_new boolean := false;
  v_invoice_map jsonb := '{}'::jsonb;
  v_payment_map jsonb := '{}'::jsonb;
  v_item jsonb;
  v_row jsonb;
  v_match jsonb;
  v_evidence jsonb;
  v_reference jsonb;
  v_client_id text;
  v_canonical_client_id text;
  v_identity_key text;
  v_db_id uuid;
  v_import_row_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_normalized_customer_name text;
  v_primary_payment_id uuid;
  v_match_id uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_currency_code text;
  v_method text;
  v_confidence text;
  v_remaining_application bigint;
  v_record_amount bigint;
  v_link_amount bigint;
  v_match_index integer := 0;
  v_sequence integer;
  v_record_is_new boolean;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_new_payment_count integer := 0;
  v_duplicate_payment_count integer := 0;
  v_duplicate_invoice_count integer := 0;
  v_carried_payment_count integer := 0;
  v_resolved_payment_count integer := 0;
  v_new_payment_client_ids text[] := '{}'::text[];
  v_existing_payment_client_ids text[] := '{}'::text[];
  v_carried_payment_client_ids text[] := '{}'::text[];
  v_resolved_payment_client_ids text[] := '{}'::text[];
  v_snapshot_invoice_client_ids text[] := '{}'::text[];
  v_snapshot_payment_client_ids text[] := '{}'::text[];
  v_canonical_snapshot_invoices jsonb := '[]'::jsonb;
  v_canonical_snapshot_payments jsonb := '[]'::jsonb;
  v_sanitized_matches jsonb := '[]'::jsonb;
  v_cross_file_duplicate_payments jsonb := '[]'::jsonb;
  v_sanitized_snapshot jsonb := p_snapshot;
  v_reservation public.reconciliation_usage_reservations%rowtype;
begin
  if v_actor is null
     or not (auth.role() = 'authenticated' or v_async_worker) then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not v_async_worker and not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_run_key is null or p_run_key !~ '^[A-Za-z0-9:_-]{8,190}$' then
    raise exception using errcode = '22023', message = 'The reconciliation run key is invalid';
  end if;
  if p_engine_version is null or btrim(p_engine_version) = '' or char_length(p_engine_version) > 100 then
    raise exception using errcode = '22023', message = 'The engine version is invalid';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'invoices') is distinct from 'array'
     or jsonb_typeof(p_snapshot -> 'payments') is distinct from 'array'
     or jsonb_typeof(p_snapshot -> 'result') is distinct from 'object'
     or jsonb_typeof(p_snapshot #> '{result,matches}') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot is invalid';
  end if;
  if p_snapshot ->> 'runId' is distinct from p_run_key
     or jsonb_array_length(p_snapshot -> 'invoices') > 50000
     or jsonb_array_length(p_snapshot -> 'payments') > 50000
     or jsonb_array_length(p_snapshot #> '{result,matches}') > 100000
     or octet_length(p_snapshot::text) > 52428800 then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot exceeds the accepted limits';
  end if;
  if jsonb_typeof(p_invoice_import) is distinct from 'object'
     or jsonb_typeof(p_payment_import) is distinct from 'object'
     or jsonb_typeof(p_invoice_import -> 'rows') is distinct from 'array'
     or jsonb_typeof(p_payment_import -> 'rows') is distinct from 'array'
     or jsonb_typeof(p_invoice_import -> 'columnMapping') is distinct from 'object'
     or jsonb_typeof(p_payment_import -> 'columnMapping') is distinct from 'object'
     or jsonb_typeof(p_invoice_import -> 'sourceHeaders') is distinct from 'array'
     or jsonb_typeof(p_payment_import -> 'sourceHeaders') is distinct from 'array'
     or jsonb_array_length(p_invoice_import -> 'rows') > 50000
     or jsonb_array_length(p_payment_import -> 'rows') > 50000 then
    raise exception using errcode = '22023', message = 'The import metadata is invalid';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id and w.status = 'active';
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_run_key || ':' || p_engine_version, 0)
  );
  select * into v_existing
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id
    and r.run_key = p_run_key
    and r.engine_version = p_engine_version;
  if found then
    return jsonb_build_object(
      'run_record_id', v_existing.id,
      'saved_at', v_existing.completed_at,
      'existing', true,
      'new_payment_count', case
        when jsonb_typeof(v_existing.snapshot -> 'usagePaymentCount') = 'number'
          then (v_existing.snapshot ->> 'usagePaymentCount')::integer
        else jsonb_array_length(v_existing.snapshot -> 'payments')
      end,
      'duplicate_payment_count', coalesce((v_existing.snapshot #>> '{importSummary,paymentsPreviouslyImported}')::integer, 0),
      'carried_payment_count', coalesce((v_existing.snapshot #>> '{importSummary,paymentsCarriedForward}')::integer, 0),
      'resolved_payment_count', coalesce((v_existing.snapshot #>> '{importSummary,paymentsAlreadyResolved}')::integer, 0),
      'duplicate_invoice_count', coalesce((v_existing.snapshot #>> '{importSummary,invoicesPreviouslyImported}')::integer, 0)
    );
  end if;

  -- One canonical-import lock per workspace makes cross-file identity creation
  -- race-safe even when two different cumulative exports arrive together.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':canonical-import-records', 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':invoices:' || (p_invoice_import ->> 'sha256') || ':' || md5((p_invoice_import -> 'columnMapping')::text),
    0
  ));
  select i.id into v_invoice_import_id
  from public.imports i
  where i.workspace_id = p_workspace_id
    and i.import_type = 'invoices'
    and i.file_sha256 = p_invoice_import ->> 'sha256'
    and i.column_mapping = p_invoice_import -> 'columnMapping'
    and i.status <> 'cancelled'
  limit 1;
  if v_invoice_import_id is null then
    v_invoice_import_is_new := true;
    insert into public.imports (
      workspace_id, import_type, source_type, status, original_filename,
      content_type, byte_size, file_sha256, sheet_name, column_mapping,
      source_headers, total_rows, accepted_rows, rejected_rows, duplicate_rows,
      blank_rows, started_at, completed_at, created_by
    ) values (
      p_workspace_id, 'invoices', p_invoice_import ->> 'sourceType',
      case when coalesce((p_invoice_import ->> 'rejectedRows')::integer, 0)
                  + coalesce((p_invoice_import ->> 'duplicateRows')::integer, 0) > 0
        then 'completed_with_errors' else 'completed' end,
      p_invoice_import ->> 'originalFilename', p_invoice_import ->> 'contentType',
      (p_invoice_import ->> 'byteSize')::bigint, p_invoice_import ->> 'sha256',
      nullif(p_invoice_import ->> 'sheetName', ''), p_invoice_import -> 'columnMapping',
      p_invoice_import -> 'sourceHeaders', (p_invoice_import ->> 'totalRows')::integer,
      (p_invoice_import ->> 'acceptedRows')::integer, (p_invoice_import ->> 'rejectedRows')::integer,
      (p_invoice_import ->> 'duplicateRows')::integer, (p_invoice_import ->> 'blankRows')::integer,
      now(), now(), v_actor
    ) returning id into v_invoice_import_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':payments:' || (p_payment_import ->> 'sha256') || ':' || md5((p_payment_import -> 'columnMapping')::text),
    0
  ));
  select i.id into v_payment_import_id
  from public.imports i
  where i.workspace_id = p_workspace_id
    and i.import_type = 'payments'
    and i.file_sha256 = p_payment_import ->> 'sha256'
    and i.column_mapping = p_payment_import -> 'columnMapping'
    and i.status <> 'cancelled'
  limit 1;
  if v_payment_import_id is null then
    v_payment_import_is_new := true;
    insert into public.imports (
      workspace_id, import_type, source_type, status, original_filename,
      content_type, byte_size, file_sha256, sheet_name, column_mapping,
      source_headers, total_rows, accepted_rows, rejected_rows, duplicate_rows,
      blank_rows, started_at, completed_at, created_by
    ) values (
      p_workspace_id, 'payments', p_payment_import ->> 'sourceType',
      case when coalesce((p_payment_import ->> 'rejectedRows')::integer, 0)
                  + coalesce((p_payment_import ->> 'duplicateRows')::integer, 0) > 0
        then 'completed_with_errors' else 'completed' end,
      p_payment_import ->> 'originalFilename', p_payment_import ->> 'contentType',
      (p_payment_import ->> 'byteSize')::bigint, p_payment_import ->> 'sha256',
      nullif(p_payment_import ->> 'sheetName', ''), p_payment_import -> 'columnMapping',
      p_payment_import -> 'sourceHeaders', (p_payment_import ->> 'totalRows')::integer,
      (p_payment_import ->> 'acceptedRows')::integer, (p_payment_import ->> 'rejectedRows')::integer,
      (p_payment_import ->> 'duplicateRows')::integer, (p_payment_import ->> 'blankRows')::integer,
      now(), now(), v_actor
    ) returning id into v_payment_import_id;
  end if;

  if v_invoice_import_is_new then
    for v_row in select value from jsonb_array_elements(p_invoice_import -> 'rows') loop
      insert into public.import_rows (
        workspace_id, import_id, row_number, record_type, disposition,
        raw_values, normalized_values, issue_codes
      ) values (
        p_workspace_id, v_invoice_import_id, (v_row ->> 'rowNumber')::integer,
        'invoice', v_row ->> 'disposition', v_row -> 'rawValues',
        coalesce(v_row -> 'normalizedValues', '{}'::jsonb),
        coalesce(v_row -> 'issueCodes', '[]'::jsonb)
      );
    end loop;
  end if;

  if v_payment_import_is_new then
    for v_row in select value from jsonb_array_elements(p_payment_import -> 'rows') loop
      insert into public.import_rows (
        workspace_id, import_id, row_number, record_type, disposition,
        raw_values, normalized_values, issue_codes
      ) values (
        p_workspace_id, v_payment_import_id, (v_row ->> 'rowNumber')::integer,
        'payment', v_row ->> 'disposition', v_row -> 'rawValues',
        coalesce(v_row -> 'normalizedValues', '{}'::jsonb),
        coalesce(v_row -> 'issueCodes', '[]'::jsonb)
      );
    end loop;
  end if;

  -- Resolve every accepted invoice source row to one workspace-wide canonical
  -- invoice. Repeated invoice snapshots remain eligible for matching, but use
  -- the canonical current balance rather than the cumulative export's balance.
  for v_row in select value from jsonb_array_elements(p_invoice_import -> 'rows') loop
    continue when v_row ->> 'disposition' <> 'accepted';
    v_item := v_row -> 'normalizedValues';
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null or char_length(v_client_id) > 1000 or v_invoice_map ? v_client_id then
      raise exception using errcode = '22023', message = 'An invoice identifier is missing or duplicated';
    end if;
    select r.id into v_import_row_id
    from public.import_rows r
    where r.workspace_id = p_workspace_id
      and r.import_id = v_invoice_import_id
      and r.row_number = (v_row ->> 'rowNumber')::integer;
    if v_import_row_id is null then
      raise exception using errcode = '22023', message = 'Invoice source-row evidence is missing';
    end if;
    v_identity_key := app_private.record_identity_hash(app_private.invoice_record_identity(v_item));
    v_db_id := null;
    v_record_is_new := false;
    select coalesce(i.duplicate_of_id, i.id) into v_db_id
    from public.import_rows r
    join public.invoices i on i.id = r.canonical_record_id and i.workspace_id = r.workspace_id
    where r.id = v_import_row_id and r.workspace_id = p_workspace_id;
    if v_db_id is null then
      select i.id into v_db_id
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.duplicate_of_id is null
        and i.dedupe_key = v_identity_key
      for update;
    end if;
    if v_db_id is null then
      v_customer_name := btrim(v_item ->> 'customerName');
      v_normalized_customer_name := lower(regexp_replace(v_customer_name, '[^[:alnum:]]+', ' ', 'g'));
      v_customer_id := null;
      if nullif(v_item ->> 'customerId', '') is not null then
        select c.id into v_customer_id from public.customers c
        where c.workspace_id = p_workspace_id and c.external_id = v_item ->> 'customerId'
        limit 1;
      end if;
      if v_customer_id is null then
        select c.id into v_customer_id from public.customers c
        where c.workspace_id = p_workspace_id and c.normalized_name = v_normalized_customer_name
        order by c.created_at
        limit 1;
      end if;
      if v_customer_id is null then
        insert into public.customers (
          workspace_id, external_id, name, normalized_name, email, raw_source
        ) values (
          p_workspace_id, nullif(v_item ->> 'customerId', ''), v_customer_name,
          v_normalized_customer_name, nullif(v_item ->> 'customerEmail', ''),
          jsonb_build_object('reconciliation_run_id', v_run_id)
        ) returning id into v_customer_id;
      end if;
      insert into public.invoices (
        workspace_id, customer_id, import_id, import_row_id, external_id,
        invoice_number, normalized_invoice_number, invoice_date, due_date,
        original_amount_minor, outstanding_balance_minor, currency_code, status,
        po_reference, memo, dedupe_key, raw_source
      ) values (
        p_workspace_id, v_customer_id, v_invoice_import_id, v_import_row_id,
        'file:invoice:' || v_identity_key, v_item ->> 'invoiceNumber',
        coalesce(
          nullif(upper(regexp_replace(v_item ->> 'invoiceNumber', '[^[:alnum:]]', '', 'g')), ''),
          upper(btrim(v_item ->> 'invoiceNumber'))
        ),
        (v_item ->> 'invoiceDate')::date,
        case when nullif(v_item ->> 'dueDate', '') is null then null else (v_item ->> 'dueDate')::date end,
        (v_item ->> 'originalAmountMinor')::bigint,
        (v_item ->> 'outstandingAmountMinor')::bigint,
        upper(v_item ->> 'currency'), v_item ->> 'status',
        coalesce(nullif(v_item ->> 'purchaseOrder', ''), nullif(v_item ->> 'reference', '')),
        nullif(v_item ->> 'memo', ''), v_identity_key,
        jsonb_strip_nulls(jsonb_build_object(
          'client_id', v_client_id,
          'customer_name', v_item ->> 'customerName',
          'customer_email', nullif(v_item ->> 'customerEmail', ''),
          'reference', nullif(v_item ->> 'reference', ''),
          'account_id', nullif(v_item ->> 'accountId', ''),
          'reconciliation_run_id', v_run_id,
          'identity_version', 1
        ))
      ) returning id into v_db_id;
      v_record_is_new := true;
    else
      select i.* into v_invoice
      from public.invoices i
      where i.id = v_db_id
        and i.workspace_id = p_workspace_id
        and i.duplicate_of_id is null
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'The canonical invoice is unavailable';
      end if;
      v_record_amount := least(
        v_invoice.outstanding_balance_minor,
        (v_item ->> 'outstandingAmountMinor')::bigint
      );
      v_method := case
        when v_invoice.status = 'void' or v_item ->> 'status' = 'void' then 'void'
        when v_invoice.status = 'paid' or v_item ->> 'status' = 'paid' then 'paid'
        when v_record_amount = 0 then 'paid'
        when v_record_amount < v_invoice.original_amount_minor then 'partially_paid'
        else 'open'
      end;
      update public.invoices i
      set outstanding_balance_minor = v_record_amount,
          status = v_method
      where i.id = v_db_id and i.workspace_id = p_workspace_id;
    end if;
    update public.import_rows r
    set canonical_record_id = v_db_id,
        dedupe_hash = v_identity_key,
        disposition = case when v_record_is_new or not v_invoice_import_is_new then r.disposition else 'duplicate' end,
        issue_codes = case
          when not v_record_is_new and v_invoice_import_is_new and not (r.issue_codes ? 'duplicate_across_imports')
            then r.issue_codes || '["duplicate_across_imports"]'::jsonb
          else r.issue_codes
        end
    where r.id = v_import_row_id and r.workspace_id = p_workspace_id;
    if not v_record_is_new then
      v_duplicate_invoice_count := v_duplicate_invoice_count + 1;
    end if;
    v_invoice_map := v_invoice_map || jsonb_build_object(v_client_id, v_db_id::text);
  end loop;

  -- Payments are different from invoice snapshots: their source row is always
  -- evidence-only once canonicalized. A still-unapplied canonical payment may
  -- be carried into the latest run, but is neither inserted nor billed again.
  for v_row in select value from jsonb_array_elements(p_payment_import -> 'rows') loop
    continue when v_row ->> 'disposition' <> 'accepted';
    v_item := v_row -> 'normalizedValues';
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null or char_length(v_client_id) > 1000 or v_payment_map ? v_client_id then
      raise exception using errcode = '22023', message = 'A payment identifier is missing or duplicated';
    end if;
    select r.id into v_import_row_id
    from public.import_rows r
    where r.workspace_id = p_workspace_id
      and r.import_id = v_payment_import_id
      and r.row_number = (v_row ->> 'rowNumber')::integer;
    if v_import_row_id is null then
      raise exception using errcode = '22023', message = 'Payment source-row evidence is missing';
    end if;
    v_identity_key := app_private.record_identity_hash(app_private.payment_record_identity(v_item));
    v_db_id := null;
    v_record_is_new := false;
    select coalesce(p.duplicate_of_id, p.id) into v_db_id
    from public.import_rows r
    join public.payments p on p.id = r.canonical_record_id and p.workspace_id = r.workspace_id
    where r.id = v_import_row_id and r.workspace_id = p_workspace_id;
    if v_db_id is null then
      select p.id into v_db_id
      from public.payments p
      where p.workspace_id = p_workspace_id
        and p.duplicate_of_id is null
        and p.dedupe_key = v_identity_key
      for update;
    end if;
    if v_db_id is null then
      insert into public.payments (
        workspace_id, import_id, import_row_id, external_id, transaction_date,
        amount_minor, unapplied_amount_minor, currency_code, payer_name,
        normalized_payer_name, description, memo, bank_reference, ach_id,
        wire_id, account_reference, status, dedupe_key, raw_source
      ) values (
        p_workspace_id, v_payment_import_id, v_import_row_id,
        'file:payment:' || v_identity_key,
        (v_item ->> 'paymentDate')::date,
        (v_item ->> 'amountMinor')::bigint, (v_item ->> 'amountMinor')::bigint,
        upper(v_item ->> 'currency'), nullif(v_item ->> 'payerName', ''),
        nullif(lower(regexp_replace(v_item ->> 'payerName', '[^[:alnum:]]+', ' ', 'g')), ''),
        nullif(v_item ->> 'description', ''), nullif(v_item ->> 'memo', ''),
        nullif(v_item ->> 'bankReference', ''), nullif(v_item ->> 'achId', ''),
        nullif(v_item ->> 'wireId', ''), nullif(v_item ->> 'accountId', ''),
        'unmatched', v_identity_key,
        jsonb_strip_nulls(jsonb_build_object(
          'client_id', v_client_id,
          'payer_id', nullif(v_item ->> 'payerId', ''),
          'transaction_id', nullif(v_item ->> 'transactionId', ''),
          'reconciliation_run_id', v_run_id,
          'identity_version', 1
        ))
      ) returning id into v_db_id;
      v_record_is_new := true;
      v_new_payment_count := v_new_payment_count + 1;
      v_new_payment_client_ids := array_append(v_new_payment_client_ids, v_client_id);
    else
      select p.* into v_payment
      from public.payments p
      where p.id = v_db_id
        and p.workspace_id = p_workspace_id
        and p.duplicate_of_id is null
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'The canonical payment is unavailable';
      end if;
      v_duplicate_payment_count := v_duplicate_payment_count + 1;
      v_existing_payment_client_ids := array_append(v_existing_payment_client_ids, v_client_id);
      if v_payment.unapplied_amount_minor > 0
         and v_payment.status not in ('reconciled', 'ignored') then
        v_carried_payment_count := v_carried_payment_count + 1;
        v_carried_payment_client_ids := array_append(v_carried_payment_client_ids, v_client_id);
      else
        v_resolved_payment_count := v_resolved_payment_count + 1;
        v_resolved_payment_client_ids := array_append(v_resolved_payment_client_ids, v_client_id);
        v_canonical_client_id := coalesce(nullif(v_payment.raw_source ->> 'client_id', ''), v_payment.id::text);
        v_cross_file_duplicate_payments := v_cross_file_duplicate_payments || jsonb_build_array(jsonb_build_object(
          'kind', 'payment',
          'canonicalId', v_canonical_client_id,
          'duplicateIds', jsonb_build_array(v_client_id),
          'reason', 'This payment was already fully handled in this workspace and was not processed again.'
        ));
      end if;
    end if;
    update public.import_rows r
    set canonical_record_id = v_db_id,
        dedupe_hash = v_identity_key,
        disposition = case when v_record_is_new or not v_payment_import_is_new then r.disposition else 'duplicate' end,
        issue_codes = case
          when not v_record_is_new and v_payment_import_is_new and not (r.issue_codes ? 'duplicate_across_imports')
            then r.issue_codes || '["duplicate_across_imports"]'::jsonb
          else r.issue_codes
        end
    where r.id = v_import_row_id and r.workspace_id = p_workspace_id;
    v_payment_map := v_payment_map || jsonb_build_object(v_client_id, v_db_id::text);
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'invoices') loop
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null or v_client_id = any(v_snapshot_invoice_client_ids) then
      raise exception using errcode = '22023', message = 'The snapshot invoice identifiers are invalid';
    end if;
    v_snapshot_invoice_client_ids := array_append(v_snapshot_invoice_client_ids, v_client_id);
    v_db_id := nullif(v_invoice_map ->> v_client_id, '')::uuid;
    if v_db_id is null then
      raise exception using errcode = '22023', message = 'The snapshot references an unknown invoice source row';
    end if;
    select i.outstanding_balance_minor, i.status
    into v_record_amount, v_method
    from public.invoices i
    where i.id = v_db_id and i.workspace_id = p_workspace_id and i.duplicate_of_id is null;
    if not found then
      raise exception using errcode = '22023', message = 'The canonical invoice is unavailable';
    end if;
    if (v_item ->> 'outstandingAmountMinor')::bigint <> v_record_amount
       or v_item ->> 'status' is distinct from v_method then
      raise exception using errcode = '40001', message = 'Canonical invoice state changed; retry reconciliation';
    end if;
    v_canonical_snapshot_invoices := v_canonical_snapshot_invoices || jsonb_build_array(
      v_item || jsonb_build_object('outstandingAmountMinor', v_record_amount, 'status', v_method)
    );
  end loop;
  if cardinality(v_snapshot_invoice_client_ids) <> jsonb_object_length(v_invoice_map) then
    raise exception using errcode = '22023', message = 'The snapshot does not contain every accepted invoice';
  end if;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'payments') loop
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null or v_client_id = any(v_snapshot_payment_client_ids) then
      raise exception using errcode = '22023', message = 'The snapshot payment identifiers are invalid';
    end if;
    v_snapshot_payment_client_ids := array_append(v_snapshot_payment_client_ids, v_client_id);
    v_db_id := nullif(v_payment_map ->> v_client_id, '')::uuid;
    if v_db_id is null then
      raise exception using errcode = '22023', message = 'The snapshot references an unknown payment source row';
    end if;
    select p.* into v_payment
    from public.payments p
    where p.id = v_db_id and p.workspace_id = p_workspace_id and p.duplicate_of_id is null;
    if not found then
      raise exception using errcode = '22023', message = 'The canonical payment is unavailable';
    end if;
    if v_client_id = any(v_resolved_payment_client_ids) then
      raise exception using errcode = '40001', message = 'Canonical payment availability changed; retry reconciliation';
    end if;
    v_record_amount := case
      when v_client_id = any(v_existing_payment_client_ids) then v_payment.unapplied_amount_minor
      else v_payment.amount_minor
    end;
    if (v_item ->> 'amountMinor')::bigint <> v_record_amount then
      raise exception using errcode = '40001', message = 'Canonical payment availability changed; retry reconciliation';
    end if;
    v_canonical_snapshot_payments := v_canonical_snapshot_payments || jsonb_build_array(
      v_item || jsonb_build_object('amountMinor', v_record_amount)
    );
  end loop;
  if exists (
    select 1
    from unnest(v_new_payment_client_ids || v_carried_payment_client_ids) as required(required_id)
    where not (required.required_id = any(v_snapshot_payment_client_ids))
  ) then
    raise exception using errcode = '22023', message = 'The snapshot does not contain every actionable payment';
  end if;

  select coalesce(jsonb_agg(candidate.value order by candidate.ordinality), '[]'::jsonb)
  into v_sanitized_matches
  from jsonb_array_elements(p_snapshot #> '{result,matches}') with ordinality as candidate(value, ordinality)
  where not exists (
    select 1
    from jsonb_array_elements_text(coalesce(candidate.value -> 'paymentIds', '[]'::jsonb)) payment_id
    where payment_id = any(v_resolved_payment_client_ids)
  );

  v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{invoices}', v_canonical_snapshot_invoices);
  v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{payments}', v_canonical_snapshot_payments);
  v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{usagePaymentCount}', to_jsonb(v_new_payment_count), true);
  v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{result,matches}', v_sanitized_matches);
  v_sanitized_snapshot := jsonb_set(
    v_sanitized_snapshot,
    '{result,duplicatePayments}',
    coalesce(v_sanitized_snapshot #> '{result,duplicatePayments}', '[]'::jsonb) || v_cross_file_duplicate_payments,
    true
  );
  if jsonb_typeof(v_sanitized_snapshot -> 'importSummary') = 'object' then
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,paymentsActiveInRun}', to_jsonb(jsonb_array_length(v_canonical_snapshot_payments)), true);
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,paymentsNew}', to_jsonb(v_new_payment_count), true);
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,paymentsPreviouslyImported}', to_jsonb(v_duplicate_payment_count), true);
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,paymentsCarriedForward}', to_jsonb(v_carried_payment_count), true);
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,paymentsAlreadyResolved}', to_jsonb(v_resolved_payment_count), true);
    v_sanitized_snapshot := jsonb_set(v_sanitized_snapshot, '{importSummary,invoicesPreviouslyImported}', to_jsonb(v_duplicate_invoice_count), true);
  end if;

  if v_invoice_import_is_new then
    update public.imports i
    set accepted_rows = counts.accepted_rows,
        rejected_rows = counts.rejected_rows,
        duplicate_rows = counts.duplicate_rows,
        blank_rows = counts.blank_rows,
        status = case when counts.rejected_rows + counts.duplicate_rows > 0 then 'completed_with_errors' else 'completed' end
    from (
      select
        count(*) filter (where r.disposition = 'accepted')::integer as accepted_rows,
        count(*) filter (where r.disposition = 'rejected')::integer as rejected_rows,
        count(*) filter (where r.disposition = 'duplicate')::integer as duplicate_rows,
        count(*) filter (where r.disposition = 'blank')::integer as blank_rows
      from public.import_rows r where r.import_id = v_invoice_import_id
    ) counts
    where i.id = v_invoice_import_id and i.workspace_id = p_workspace_id;
  end if;
  if v_payment_import_is_new then
    update public.imports i
    set accepted_rows = counts.accepted_rows,
        rejected_rows = counts.rejected_rows,
        duplicate_rows = counts.duplicate_rows,
        blank_rows = counts.blank_rows,
        status = case when counts.rejected_rows + counts.duplicate_rows > 0 then 'completed_with_errors' else 'completed' end
    from (
      select
        count(*) filter (where r.disposition = 'accepted')::integer as accepted_rows,
        count(*) filter (where r.disposition = 'rejected')::integer as rejected_rows,
        count(*) filter (where r.disposition = 'duplicate')::integer as duplicate_rows,
        count(*) filter (where r.disposition = 'blank')::integer as blank_rows
      from public.import_rows r where r.import_id = v_payment_import_id
    ) counts
    where i.id = v_payment_import_id and i.workspace_id = p_workspace_id;
  end if;

  select reservation.* into v_reservation
  from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = p_workspace_id
    and reservation.run_key = p_run_key
    and reservation.engine_version = p_engine_version
  for update;
  if not found
     or v_reservation.status <> 'reserved'
     or v_reservation.expires_at <= statement_timestamp()
     or v_reservation.payment_count < v_new_payment_count then
    raise exception using errcode = 'P0001', message = 'A valid reconciliation payment-capacity reservation is required';
  end if;
  if v_reservation.payment_count <> v_new_payment_count then
    update public.reconciliation_usage_reservations
    set payment_count = v_new_payment_count
    where id = v_reservation.id;
  end if;

  insert into public.reconciliation_runs (
    id, workspace_id, invoice_import_id, payment_import_id, run_key,
    engine_version, status, snapshot, created_by, started_at, completed_at
  ) values (
    v_run_id, p_workspace_id, v_invoice_import_id, v_payment_import_id, p_run_key,
    p_engine_version, 'completed', v_sanitized_snapshot, v_actor, now(), now()
  ) returning completed_at into v_saved_at;

  for v_match in select value from jsonb_array_elements(v_sanitized_matches) loop
    v_match_index := v_match_index + 1;
    v_client_id := v_match #>> '{paymentIds,0}';
    v_primary_payment_id := nullif(v_payment_map ->> v_client_id, '')::uuid;
    if v_primary_payment_id is null then
      raise exception using errcode = '22023', message = 'A match references an unknown payment';
    end if;
    select p.currency_code into v_currency_code from public.payments p
    where p.id = v_primary_payment_id and p.workspace_id = p_workspace_id
      and p.duplicate_of_id is null;
    if not found then
      raise exception using errcode = '22023', message = 'A match references a duplicate payment';
    end if;
    v_confidence := case v_match ->> 'confidence'
      when 'high_confidence' then 'high'
      else v_match ->> 'confidence'
    end;
    v_method := case v_match ->> 'method'
      when 'reference_match' then 'invoice_reference'
      when 'grouped_payments' then 'combined_payments'
      when 'partial_payment' then 'partial'
      when 'possible_fee_or_deduction' then 'possible_fee'
      else v_match ->> 'method'
    end;
    insert into public.matches (
      workspace_id, reconciliation_run_id, client_match_id, payment_id, status,
      confidence_category, matching_method, engine_version, idempotency_key,
      payment_amount_minor, proposed_application_minor, discrepancy_minor,
      currency_code, requires_review
    ) values (
      p_workspace_id, v_run_id, v_match ->> 'id', v_primary_payment_id, 'suggested',
      v_confidence, v_method, p_engine_version, v_run_id::text || ':' || v_match_index::text,
      (v_match ->> 'paymentAmountMinor')::bigint,
      (v_match ->> 'appliedAmountMinor')::bigint,
      (v_match ->> 'discrepancyMinor')::bigint,
      v_currency_code, coalesce((v_match ->> 'requiresConfirmation')::boolean, true)
    ) returning id into v_match_id;

    v_sequence := 0;
    for v_reference in select value from jsonb_array_elements(v_match -> 'paymentIds') loop
      v_sequence := v_sequence + 1;
      v_payment_id := nullif(v_payment_map ->> (v_reference #>> '{}'), '')::uuid;
      if v_payment_id is null then
        raise exception using errcode = '22023', message = 'A match references an unknown payment';
      end if;
      select case
        when (v_reference #>> '{}') = any(v_existing_payment_client_ids)
          then p.unapplied_amount_minor
        else p.amount_minor
      end into v_record_amount
      from public.payments p
      where p.id = v_payment_id and p.workspace_id = p_workspace_id
        and p.duplicate_of_id is null;
      if not found then
        raise exception using errcode = '22023', message = 'A match references a duplicate payment';
      end if;
      insert into public.match_payment_links (
        workspace_id, match_id, payment_id, amount_minor, sequence_number
      ) values (
        p_workspace_id, v_match_id, v_payment_id, v_record_amount, v_sequence
      );
    end loop;

    v_remaining_application := (v_match ->> 'appliedAmountMinor')::bigint;
    v_sequence := 0;
    for v_reference in select value from jsonb_array_elements(v_match -> 'invoiceIds') loop
      exit when v_remaining_application <= 0;
      v_sequence := v_sequence + 1;
      v_invoice_id := nullif(v_invoice_map ->> (v_reference #>> '{}'), '')::uuid;
      if v_invoice_id is null then
        raise exception using errcode = '22023', message = 'A match references an unknown invoice';
      end if;
      select i.outstanding_balance_minor into v_record_amount from public.invoices i
      where i.id = v_invoice_id and i.workspace_id = p_workspace_id
        and i.duplicate_of_id is null;
      if not found then
        raise exception using errcode = '22023', message = 'A match references a duplicate invoice';
      end if;
      v_link_amount := least(v_remaining_application, v_record_amount);
      if v_link_amount > 0 then
        insert into public.match_invoice_links (
          workspace_id, match_id, invoice_id, applied_amount_minor, sequence_number
        ) values (
          p_workspace_id, v_match_id, v_invoice_id, v_link_amount, v_sequence
        );
        v_remaining_application := v_remaining_application - v_link_amount;
      end if;
    end loop;

    v_sequence := 0;
    for v_evidence in select value from jsonb_array_elements(coalesce(v_match -> 'evidence', '[]'::jsonb)) loop
      v_sequence := v_sequence + 1;
      insert into public.match_explanations (
        workspace_id, match_id, reason_code, strength, display_order,
        explanation_text, evidence
      ) values (
        p_workspace_id, v_match_id, v_evidence ->> 'code', v_evidence ->> 'strength',
        v_sequence, v_evidence ->> 'message',
        jsonb_strip_nulls(jsonb_build_object('value', v_evidence -> 'value'))
      );
    end loop;
  end loop;

  update public.payments p set status = case
    when exists (
      select 1 from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and pl.payment_id = p.id
        and m.reconciliation_run_id = v_run_id
        and (m.confidence_category = 'review' or m.matching_method = 'duplicate_payment')
    ) then 'review'
    when exists (
      select 1 from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and pl.payment_id = p.id
        and m.reconciliation_run_id = v_run_id
        and m.confidence_category in ('exact', 'high')
    ) then 'suggested'
    else 'unmatched'
  end
  where p.workspace_id = p_workspace_id
    and p.id in (
      select pl.payment_id from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and m.reconciliation_run_id = v_run_id
    );

  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values (
    v_organization_id, p_workspace_id, 'payments_processed', current_date, current_date,
    v_new_payment_count, 'reconciliation-run:' || v_run_id::text || ':payments'
  );
  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values (
    v_organization_id, p_workspace_id, 'imports_completed', current_date, current_date,
    2, 'reconciliation-run:' || v_run_id::text || ':imports'
  );
  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type, event_type, entity_type,
    entity_id, source_import_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, v_actor_type, 'reconciliation_run.completed',
    'reconciliation_run', v_run_id, v_invoice_import_id,
    jsonb_build_object(
      'engine_version', p_engine_version,
      'invoice_count', jsonb_array_length(v_canonical_snapshot_invoices),
      'payment_count', v_new_payment_count,
      'duplicate_invoice_rows', v_duplicate_invoice_count,
      'duplicate_payment_rows', v_duplicate_payment_count,
      'match_count', jsonb_array_length(v_sanitized_matches),
      'source_imports', jsonb_build_array(
        jsonb_build_object(
          'id', v_invoice_import_id,
          'type', 'invoices',
          'filename', p_invoice_import ->> 'originalFilename',
          'accepted_rows', (select i.accepted_rows from public.imports i where i.id = v_invoice_import_id),
          'rejected_rows', (select i.rejected_rows from public.imports i where i.id = v_invoice_import_id),
          'duplicate_rows', (select i.duplicate_rows from public.imports i where i.id = v_invoice_import_id)
        ),
        jsonb_build_object(
          'id', v_payment_import_id,
          'type', 'payments',
          'filename', p_payment_import ->> 'originalFilename',
          'accepted_rows', (select i.accepted_rows from public.imports i where i.id = v_payment_import_id),
          'rejected_rows', (select i.rejected_rows from public.imports i where i.id = v_payment_import_id),
          'duplicate_rows', (select i.duplicate_rows from public.imports i where i.id = v_payment_import_id)
        )
      )
    )
  );

  return jsonb_build_object(
    'run_record_id', v_run_id,
    'saved_at', v_saved_at,
    'existing', false,
    'new_payment_count', v_new_payment_count,
    'duplicate_payment_count', v_duplicate_payment_count,
    'carried_payment_count', v_carried_payment_count,
    'resolved_payment_count', v_resolved_payment_count,
    'duplicate_invoice_count', v_duplicate_invoice_count
  );
end;
$$;

-- Decisions in a remapped run resolve that run's source invoice ID through
-- import_rows.canonical_record_id. The original import/raw provenance on the
-- canonical invoice remains immutable and older runs stay addressable.
create or replace function public.record_reconciliation_decision_v2(
  p_workspace_id uuid,
  p_run_record_id uuid,
  p_client_match_id text,
  p_outcome text,
  p_invoice_allocations jsonb,
  p_applied_amount_minor bigint,
  p_note text,
  p_fee_minor bigint,
  p_feedback text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_run public.reconciliation_runs%rowtype;
  v_match public.matches%rowtype;
  v_existing_action public.reconciliation_actions%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_allocation_item record;
  v_numeric_amount numeric;
  v_object_key_count integer;
  v_invoice_count integer;
  v_index integer;
  v_selected_invoice_ids uuid[] := '{}'::uuid[];
  v_selected_invoice_client_ids text[] := '{}'::text[];
  v_selected_invoice_amounts bigint[] := '{}'::bigint[];
  v_client_invoice_id text;
  v_total_payment_available bigint := 0;
  v_target_application bigint := 0;
  v_remaining_application bigint := 0;
  v_allocation bigint := 0;
  v_sequence integer := 0;
  v_invoice_balances jsonb := '{}'::jsonb;
  v_source_imports jsonb := '[]'::jsonb;
  v_payment_links jsonb := '[]'::jsonb;
  v_proposed_invoice_links jsonb := '[]'::jsonb;
  v_match_evidence jsonb := '[]'::jsonb;
  v_invoice_applications jsonb := '[]'::jsonb;
  v_payment_applications jsonb := '[]'::jsonb;
  v_canonical_invoice_allocations jsonb := '[]'::jsonb;
  v_previous_state jsonb;
  v_new_state jsonb;
  v_decision jsonb;
  v_action_type text;
  v_action_id uuid;
  v_decided_at timestamptz := now();
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_outcome is null
     or p_outcome not in ('confirmed', 'rejected', 'unmatched')
     or nullif(btrim(p_client_match_id), '') is null
     or char_length(p_client_match_id) > 1000
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 200
     or char_length(coalesce(p_note, '')) > 2000
     or coalesce(p_fee_minor, 0) < 0
     or coalesce(p_fee_minor, 0) > 9007199254740991
     or p_applied_amount_minor is null
     or p_applied_amount_minor < 0
     or p_applied_amount_minor > 9007199254740991
     or (p_feedback is not null and p_feedback not in ('correct', 'incorrect')) then
    raise exception using errcode = '22023', message = 'The reconciliation decision is invalid';
  end if;
  if p_invoice_allocations is null or jsonb_typeof(p_invoice_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'Invoice allocations must be an array';
  end if;
  if jsonb_array_length(p_invoice_allocations) > 100 then
    raise exception using errcode = '22023', message = 'A decision can allocate to at most 100 invoices';
  end if;
  if p_outcome = 'confirmed'
     and (jsonb_array_length(p_invoice_allocations) = 0 or p_applied_amount_minor <= 0) then
    raise exception using errcode = '22023', message = 'A confirmed decision requires a positive invoice allocation';
  end if;
  if p_outcome <> 'confirmed'
     and (jsonb_array_length(p_invoice_allocations) <> 0 or p_applied_amount_minor <> 0) then
    raise exception using errcode = '22023', message = 'Only confirmed decisions can allocate invoice amounts';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id;
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':decision:' || p_idempotency_key, 0)
  );
  select a.* into v_existing_action
  from public.reconciliation_actions a
  where a.workspace_id = p_workspace_id
    and a.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'action_id', v_existing_action.id,
      'decision', v_existing_action.new_state -> 'decision',
      'invoice_balances', coalesce(v_existing_action.new_state -> 'invoiceBalances', '{}'::jsonb),
      'existing', true
    );
  end if;

  select r.* into v_run
  from public.reconciliation_runs r
  where r.id = p_run_record_id
    and r.workspace_id = p_workspace_id
    and r.status = 'completed';
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation run is not available in this workspace';
  end if;

  select m.* into v_match
  from public.matches m
  where m.workspace_id = p_workspace_id
    and m.reconciliation_run_id = p_run_record_id
    and m.client_match_id = p_client_match_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation match is not available in this run';
  end if;
  if v_match.status <> 'suggested' then
    raise exception using errcode = '55000', message = 'This reconciliation match already has a decision';
  end if;

  perform 1
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
  order by p.id
  for update of p;

  if exists (
    select 1
    from public.payments p
    join public.match_payment_links pl
      on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
    where pl.workspace_id = p_workspace_id
      and pl.match_id = v_match.id
      and p.currency_code <> v_match.currency_code
  ) then
    raise exception using errcode = '22023', message = 'Every linked payment must use the match currency';
  end if;

  select coalesce(sum(p.unapplied_amount_minor), 0) into v_total_payment_available
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select jsonb_build_array(
    jsonb_build_object(
      'id', ii.id,
      'type', ii.import_type,
      'filename', ii.original_filename,
      'accepted_rows', ii.accepted_rows,
      'rejected_rows', ii.rejected_rows
    ),
    jsonb_build_object(
      'id', pi.id,
      'type', pi.import_type,
      'filename', pi.original_filename,
      'accepted_rows', pi.accepted_rows,
      'rejected_rows', pi.rejected_rows
    )
  ) into v_source_imports
  from public.imports ii
  cross join public.imports pi
  where ii.id = v_run.invoice_import_id and ii.workspace_id = p_workspace_id
    and pi.id = v_run.payment_import_id and pi.workspace_id = p_workspace_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'paymentId', coalesce(nullif(p.raw_source ->> 'client_id', ''), p.id::text),
    'recordId', p.id,
    'amountMinor', p.amount_minor,
    'unappliedAmountMinorBefore', p.unapplied_amount_minor,
    'currency', p.currency_code,
    'transactionId', nullif(p.raw_source ->> 'transaction_id', ''),
    'bankReference', p.bank_reference,
    'sourceImportId', p.import_id
  )) order by pl.sequence_number), '[]'::jsonb)
  into v_payment_links
  from public.match_payment_links pl
  join public.payments p on p.id = pl.payment_id and p.workspace_id = pl.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invoiceId', coalesce(nullif(i.raw_source ->> 'client_id', ''), i.id::text),
    'recordId', i.id,
    'invoiceNumber', i.invoice_number,
    'proposedAmountMinor', l.applied_amount_minor,
    'outstandingAmountMinorBefore', i.outstanding_balance_minor
  ) order by l.sequence_number), '[]'::jsonb)
  into v_proposed_invoice_links
  from public.match_invoice_links l
  join public.invoices i on i.id = l.invoice_id and i.workspace_id = l.workspace_id
  where l.workspace_id = p_workspace_id and l.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', e.reason_code,
    'strength', e.strength,
    'message', e.explanation_text,
    'evidence', e.evidence
  ) order by e.display_order), '[]'::jsonb)
  into v_match_evidence
  from public.match_explanations e
  where e.workspace_id = p_workspace_id and e.match_id = v_match.id;

  v_previous_state := jsonb_build_object(
    'matchStatus', v_match.status,
    'matchingMethod', v_match.matching_method,
    'confidence', v_match.confidence_category,
    'proposedApplicationMinor', v_match.proposed_application_minor,
    'discrepancyMinor', v_match.discrepancy_minor,
    'paymentLinks', v_payment_links,
    'invoiceLinks', v_proposed_invoice_links,
    'evidence', v_match_evidence
  );

  if p_outcome = 'confirmed' then
    for v_allocation_item in
      select value, ordinality::integer as sequence_number
      from jsonb_array_elements(p_invoice_allocations) with ordinality
      order by ordinality
    loop
      if jsonb_typeof(v_allocation_item.value) <> 'object' then
        raise exception using errcode = '22023', message = 'Every invoice allocation must be an object';
      end if;
      select count(*) into v_object_key_count
      from jsonb_object_keys(v_allocation_item.value);
      if v_object_key_count <> 2
         or not (v_allocation_item.value ? 'invoiceId')
         or not (v_allocation_item.value ? 'amountMinor')
         or jsonb_typeof(v_allocation_item.value -> 'invoiceId') <> 'string'
         or jsonb_typeof(v_allocation_item.value -> 'amountMinor') <> 'number' then
        raise exception using errcode = '22023', message = 'Every allocation requires only an invoiceId and integer amountMinor';
      end if;

      v_client_invoice_id := btrim(v_allocation_item.value ->> 'invoiceId');
      v_numeric_amount := (v_allocation_item.value ->> 'amountMinor')::numeric;
      if nullif(v_client_invoice_id, '') is null
         or char_length(v_client_invoice_id) > 1000
         or v_client_invoice_id = any(v_selected_invoice_client_ids)
         or v_numeric_amount <> trunc(v_numeric_amount)
         or v_numeric_amount <= 0
         or v_numeric_amount > 9007199254740991 then
        raise exception using errcode = '22023', message = 'Invoice allocations require unique invoice IDs and positive integer minor amounts';
      end if;
      v_selected_invoice_client_ids := array_append(v_selected_invoice_client_ids, v_client_invoice_id);
      v_selected_invoice_amounts := array_append(v_selected_invoice_amounts, v_numeric_amount::bigint);
      v_canonical_invoice_allocations := v_canonical_invoice_allocations || jsonb_build_array(jsonb_build_object(
        'invoiceId', v_client_invoice_id,
        'amountMinor', v_numeric_amount::bigint
      ));
      if v_target_application > 9007199254740991 - v_numeric_amount::bigint then
        raise exception using errcode = '22023', message = 'The invoice allocation total is too large';
      end if;
      v_target_application := v_target_application + v_numeric_amount::bigint;
    end loop;

    if v_target_application <> p_applied_amount_minor then
      raise exception using errcode = '22023', message = 'The applied total must equal the invoice allocation total';
    end if;

    perform 1
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.duplicate_of_id is null
      and (
        (
          i.import_id = v_run.invoice_import_id
          and i.raw_source ->> 'client_id' = any(v_selected_invoice_client_ids)
        )
        or exists (
          select 1
          from public.import_rows source_row
          where source_row.workspace_id = p_workspace_id
            and source_row.import_id = v_run.invoice_import_id
            and source_row.record_type = 'invoice'
            and source_row.canonical_record_id = i.id
            and source_row.normalized_values ->> 'id' = any(v_selected_invoice_client_ids)
        )
      )
    order by i.id
    for update;

    for v_index in 1..array_length(v_selected_invoice_client_ids, 1) loop
      v_client_invoice_id := v_selected_invoice_client_ids[v_index];
      select count(*) into v_invoice_count
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.duplicate_of_id is null
        and (
          (
            i.import_id = v_run.invoice_import_id
            and i.raw_source ->> 'client_id' = v_client_invoice_id
          )
          or exists (
            select 1
            from public.import_rows source_row
            where source_row.workspace_id = p_workspace_id
              and source_row.import_id = v_run.invoice_import_id
              and source_row.record_type = 'invoice'
              and source_row.canonical_record_id = i.id
              and source_row.normalized_values ->> 'id' = v_client_invoice_id
          )
        );
      if v_invoice_count <> 1 then
        raise exception using errcode = '22023', message = 'A selected invoice is unavailable or ambiguous';
      end if;

      select i.* into v_invoice
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.duplicate_of_id is null
        and (
          (
            i.import_id = v_run.invoice_import_id
            and i.raw_source ->> 'client_id' = v_client_invoice_id
          )
          or exists (
            select 1
            from public.import_rows source_row
            where source_row.workspace_id = p_workspace_id
              and source_row.import_id = v_run.invoice_import_id
              and source_row.record_type = 'invoice'
              and source_row.canonical_record_id = i.id
              and source_row.normalized_values ->> 'id' = v_client_invoice_id
          )
        );
      if v_invoice.status not in ('open', 'partially_paid')
         or v_invoice.currency_code <> v_match.currency_code then
        raise exception using errcode = '22023', message = 'A selected invoice is unavailable, paid, or uses another currency';
      end if;
      if v_selected_invoice_amounts[v_index] > v_invoice.outstanding_balance_minor then
        raise exception using errcode = '22023', message = 'An invoice allocation exceeds its outstanding balance';
      end if;
      v_selected_invoice_ids := array_append(v_selected_invoice_ids, v_invoice.id);
    end loop;

    if v_target_application > v_total_payment_available then
      raise exception using errcode = '22023', message = 'The invoice allocations exceed the available payment amount';
    end if;
    if coalesce(p_fee_minor, 0) > v_match.payment_amount_minor then
      raise exception using errcode = '22023', message = 'The fee cannot exceed the payment amount';
    end if;

    delete from public.match_invoice_links l
    where l.workspace_id = p_workspace_id and l.match_id = v_match.id;
    for v_index in 1..array_length(v_selected_invoice_ids, 1) loop
      v_sequence := v_index;
      v_allocation := v_selected_invoice_amounts[v_index];
      update public.invoices i set
        outstanding_balance_minor = i.outstanding_balance_minor - v_allocation,
        status = case
          when i.outstanding_balance_minor - v_allocation = 0 then 'paid'
          when i.outstanding_balance_minor - v_allocation < i.original_amount_minor then 'partially_paid'
          else 'open'
        end
      where i.id = v_selected_invoice_ids[v_index]
        and i.workspace_id = p_workspace_id
        and i.outstanding_balance_minor >= v_allocation
      returning * into v_invoice;
      if not found then
        raise exception using errcode = '55000', message = 'An invoice balance changed before the allocation was applied';
      end if;
      insert into public.match_invoice_links (
        workspace_id, match_id, invoice_id, applied_amount_minor, sequence_number
      ) values (
        p_workspace_id, v_match.id, v_invoice.id, v_allocation, v_sequence
      );
      v_invoice_balances := v_invoice_balances || jsonb_build_object(
        v_selected_invoice_client_ids[v_index], v_invoice.outstanding_balance_minor
      );
      v_invoice_applications := v_invoice_applications || jsonb_build_array(jsonb_build_object(
        'invoiceId', v_selected_invoice_client_ids[v_index],
        'recordId', v_invoice.id,
        'invoiceNumber', v_invoice.invoice_number,
        'appliedAmountMinor', v_allocation,
        'resultingOutstandingAmountMinor', v_invoice.outstanding_balance_minor
      ));
    end loop;

    v_remaining_application := v_target_application;
    for v_payment in
      select p.*
      from public.payments p
      join public.match_payment_links pl
        on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
      where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      order by pl.sequence_number
      for update of p
    loop
      exit when v_remaining_application <= 0;
      v_allocation := least(v_remaining_application, v_payment.unapplied_amount_minor);
      if v_allocation <= 0 then
        continue;
      end if;
      update public.payments p set
        unapplied_amount_minor = p.unapplied_amount_minor - v_allocation,
        status = case
          when p.unapplied_amount_minor - v_allocation = 0 then 'reconciled'
          when p.unapplied_amount_minor - v_allocation < p.amount_minor then 'partially_applied'
          else 'unmatched'
        end
      where p.id = v_payment.id and p.workspace_id = p_workspace_id
      returning p.* into v_payment;
      v_payment_applications := v_payment_applications || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'paymentId', coalesce(nullif(v_payment.raw_source ->> 'client_id', ''), v_payment.id::text),
        'recordId', v_payment.id,
        'appliedAmountMinor', v_allocation,
        'resultingUnappliedAmountMinor', v_payment.unapplied_amount_minor,
        'sourceImportId', v_payment.import_id
      )));
      v_remaining_application := v_remaining_application - v_allocation;
    end loop;
    if v_remaining_application <> 0 then
      raise exception using errcode = '55000', message = 'The available payment amount changed before the allocation was applied';
    end if;

    update public.matches m set
      status = 'approved', proposed_application_minor = v_target_application,
      requires_review = false, resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    v_action_type := 'approve';
  else
    update public.matches m set
      status = 'rejected', resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    update public.payments p set status = case
      when p.unapplied_amount_minor = 0 then 'reconciled'
      when p.unapplied_amount_minor < p.amount_minor then 'partially_applied'
      else 'unmatched'
    end
    where p.workspace_id = p_workspace_id
      and p.id in (
        select pl.payment_id from public.match_payment_links pl
        where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      );
    v_action_type := case when p_outcome = 'rejected' then 'reject' else 'leave_unmatched' end;
  end if;

  v_decision := jsonb_strip_nulls(jsonb_build_object(
    'matchId', p_client_match_id,
    'outcome', p_outcome,
    'invoiceIds', case when p_outcome = 'confirmed' then to_jsonb(v_selected_invoice_client_ids) else '[]'::jsonb end,
    'allocations', case when p_outcome = 'confirmed' then v_canonical_invoice_allocations else '[]'::jsonb end,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'feeMinor', case when coalesce(p_fee_minor, 0) > 0 then p_fee_minor else null end,
    'appliedAmountMinor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
    'feedback', p_feedback,
    'decidedAt', v_decided_at
  ));
  v_new_state := jsonb_build_object(
    'decision', v_decision,
    'invoiceBalances', v_invoice_balances,
    'appliedAmountMinor', v_target_application,
    'invoiceApplications', v_invoice_applications,
    'paymentApplications', v_payment_applications,
    'paymentLinks', v_payment_links,
    'sourceImports', v_source_imports,
    'automatedProposal', jsonb_build_object(
      'matchingMethod', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'proposedApplicationMinor', v_match.proposed_application_minor,
      'discrepancyMinor', v_match.discrepancy_minor,
      'invoiceLinks', v_proposed_invoice_links,
      'evidence', v_match_evidence
    )
  );

  insert into public.reconciliation_actions (
    workspace_id, reconciliation_run_id, match_id, payment_id, actor_user_id, action_type,
    decision_note, previous_state, new_state, idempotency_key
  ) values (
    p_workspace_id, p_run_record_id, v_match.id, v_match.payment_id, v_actor, v_action_type,
    nullif(btrim(coalesce(p_note, '')), ''), v_previous_state, v_new_state,
    p_idempotency_key
  ) returning id into v_action_id;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, event_type, entity_type,
    entity_id, source_import_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor,
    'reconciliation_match.' || p_outcome, 'match', v_match.id, v_run.payment_import_id,
    jsonb_build_object(
      'action_id', v_action_id,
      'reconciliation_run_id', p_run_record_id,
      'client_match_id', p_client_match_id,
      'invoice_count', case when p_outcome = 'confirmed' then cardinality(v_selected_invoice_client_ids) else 0 end,
      'invoice_ids', case when p_outcome = 'confirmed' then to_jsonb(v_selected_invoice_client_ids) else '[]'::jsonb end,
      'invoice_allocations', case when p_outcome = 'confirmed' then v_canonical_invoice_allocations else '[]'::jsonb end,
      'applied_amount_minor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
      'currency_code', v_match.currency_code,
      'matching_method', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'payment_links', v_payment_links,
      'proposed_invoice_links', v_proposed_invoice_links,
      'match_evidence', v_match_evidence,
      'source_imports', v_source_imports,
      'has_note', nullif(btrim(coalesce(p_note, '')), '') is not null,
      'feedback', p_feedback
    )
  );

  if p_outcome = 'confirmed' then
    insert into public.usage_records (
      organization_id, workspace_id, metric_code, period_start, period_end,
      quantity, source_event_id
    ) values (
      v_organization_id, p_workspace_id, 'matches_confirmed', current_date, current_date,
      1, 'reconciliation-action:' || v_action_id::text
    );
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'decision', v_decision,
    'invoice_balances', v_invoice_balances,
    'existing', false
  );
end;
$$;

-- Latest-run hydration uses the current import's source IDs while reading the
-- balance/status from the workspace canonical invoice.
create or replace function public.get_latest_reconciliation_run(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.reconciliation_runs%rowtype;
  v_decisions jsonb := '{}'::jsonb;
  v_invoice_states jsonb := '{}'::jsonb;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_access_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  select r.* into v_run
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id and r.status = 'completed'
  order by r.completed_at desc, r.id desc
  limit 1;
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select coalesce(jsonb_object_agg(
    a.new_state #>> '{decision,matchId}',
    a.new_state -> 'decision'
    order by a.created_at
  ), '{}'::jsonb)
  into v_decisions
  from public.reconciliation_actions a
  where a.workspace_id = p_workspace_id
    and a.reconciliation_run_id = v_run.id
    and jsonb_typeof(a.new_state -> 'decision') = 'object'
    and nullif(a.new_state #>> '{decision,matchId}', '') is not null;

  select coalesce(jsonb_object_agg(
    state.client_id,
    jsonb_build_object(
      'outstandingAmountMinor', state.outstanding_balance_minor,
      'status', state.status
    )
  ), '{}'::jsonb)
  into v_invoice_states
  from (
    select distinct on (candidate.client_id)
      candidate.client_id,
      candidate.outstanding_balance_minor,
      candidate.status
    from (
      select
        source_row.normalized_values ->> 'id' as client_id,
        i.outstanding_balance_minor,
        i.status,
        1 as source_priority
      from public.import_rows source_row
      join public.invoices i
        on i.id = source_row.canonical_record_id
        and i.workspace_id = source_row.workspace_id
      where source_row.workspace_id = p_workspace_id
        and source_row.import_id = v_run.invoice_import_id
        and source_row.record_type = 'invoice'
        and nullif(source_row.normalized_values ->> 'id', '') is not null
        and i.duplicate_of_id is null
      union all
      select
        i.raw_source ->> 'client_id',
        i.outstanding_balance_minor,
        i.status,
        2
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.import_id = v_run.invoice_import_id
        and i.duplicate_of_id is null
        and nullif(i.raw_source ->> 'client_id', '') is not null
    ) candidate
    order by candidate.client_id, candidate.source_priority
  ) state;

  return jsonb_build_object(
    'status', 'ready',
    'run_record_id', v_run.id,
    'run_key', v_run.run_key,
    'snapshot', v_run.snapshot,
    'completed_at', v_run.completed_at,
    'decisions', v_decisions,
    'invoice_states', v_invoice_states
  );
end;
$$;

revoke execute on function public.persist_reconciliation_run(uuid, text, text, jsonb, jsonb, jsonb)
from authenticated;

revoke all on function public.persist_reconciliation_run_v2(uuid, text, text, jsonb, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.persist_reconciliation_run_v2(uuid, text, text, jsonb, jsonb, jsonb)
to authenticated;

comment on function public.persist_reconciliation_run_v2(uuid, text, text, jsonb, jsonb, jsonb) is
  'Persists raw import evidence while remapping repeated rows to workspace-wide canonical invoices and payments.';

commit;
