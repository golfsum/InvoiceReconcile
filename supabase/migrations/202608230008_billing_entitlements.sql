begin;

alter table public.subscriptions
add column paid_started_at timestamptz;

comment on column public.subscriptions.paid_started_at is
  'The earliest observed Stripe subscription creation time; null until a paid subscription is observed.';

create or replace function app_private.preserve_first_paid_started_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.paid_started_at is not null then
    new.paid_started_at := case
      when new.paid_started_at is null then old.paid_started_at
      else least(old.paid_started_at, new.paid_started_at)
    end;
  end if;
  return new;
end;
$$;

revoke all on function app_private.preserve_first_paid_started_at() from public;

create trigger subscriptions_preserve_first_paid_started_at
before update on public.subscriptions
for each row execute function app_private.preserve_first_paid_started_at();

create table public.reconciliation_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null,
  run_key text not null,
  engine_version text not null,
  period_start date not null,
  period_end date not null,
  plan_code text not null,
  payment_count bigint not null,
  status text not null default 'reserved',
  reconciliation_run_id uuid,
  reserved_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reconciliation_usage_reservations_workspace_org_fk
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint reconciliation_usage_reservations_run_fk
    foreign key (reconciliation_run_id, workspace_id)
    references public.reconciliation_runs(id, workspace_id) on delete cascade,
  constraint reconciliation_usage_reservations_key_check
    check (run_key ~ '^[A-Za-z0-9:_-]{8,190}$'),
  constraint reconciliation_usage_reservations_engine_check
    check (btrim(engine_version) <> '' and char_length(engine_version) <= 100),
  constraint reconciliation_usage_reservations_period_check
    check (period_end >= period_start),
  constraint reconciliation_usage_reservations_plan_check
    check (plan_code in ('free', 'solo', 'business', 'bookkeeper')),
  constraint reconciliation_usage_reservations_count_check
    check (payment_count between 0 and 50000),
  constraint reconciliation_usage_reservations_status_check
    check (status in ('reserved', 'committed')),
  constraint reconciliation_usage_reservations_commit_check
    check ((status = 'committed') = (reconciliation_run_id is not null)),
  unique (workspace_id, run_key, engine_version)
);

create index reconciliation_usage_reservations_capacity_idx
on public.reconciliation_usage_reservations (
  organization_id,
  period_start,
  period_end,
  status,
  expires_at
);

alter table public.reconciliation_usage_reservations enable row level security;

create trigger reconciliation_usage_reservations_touch_updated_at
before update on public.reconciliation_usage_reservations
for each row execute function app_private.touch_updated_at();

revoke all on public.reconciliation_usage_reservations from public, anon, authenticated;

comment on table public.reconciliation_usage_reservations is
  'Short-lived, server-created reservations that make reconciliation payment limits concurrency-safe.';

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
  v_payment_limit bigint := 50;
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
  v_payment_limit := case v_plan_code
    when 'solo' then 500
    when 'business' then 2500
    when 'bookkeeper' then 10000
    else 50
  end;

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
      'period_start', v_period_start,
      'period_end', v_period_end,
      'existing', true
    );
  end if;

  if v_has_existing_reservation
     and v_existing_reservation.status = 'reserved'
     and v_existing_reservation.expires_at > v_now
     and v_existing_reservation.period_start = v_period_start
     and v_existing_reservation.period_end = v_period_end then
    if v_existing_reservation.payment_count <> p_payment_count then
      raise exception using errcode = '22023', message = 'The reserved payment count does not match this run';
    end if;
    return jsonb_build_object(
      'allowed', true,
      'code', 'already_reserved',
      'plan', v_plan_code,
      'limit', v_payment_limit,
      'used', v_used,
      'requested', p_payment_count,
      'remaining', greatest(v_payment_limit - v_used - p_payment_count, 0),
      'period_start', v_period_start,
      'period_end', v_period_end,
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
      'period_start', v_period_start,
      'period_end', v_period_end,
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
    'period_start', v_period_start,
    'period_end', v_period_end,
    'existing', false,
    'reservation_id', v_reservation_id
  );
end;
$$;

revoke all on function public.reserve_reconciliation_capacity(uuid, text, text, bigint)
from public, anon;
grant execute on function public.reserve_reconciliation_capacity(uuid, text, text, bigint)
to authenticated;

create or replace function app_private.require_reconciliation_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.reconciliation_usage_reservations%rowtype;
begin
  if jsonb_typeof(new.snapshot -> 'payments') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot has no payment list';
  end if;

  select reservation.* into v_reservation
  from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = new.workspace_id
    and reservation.run_key = new.run_key
    and reservation.engine_version = new.engine_version;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'A valid reconciliation payment-capacity reservation is required';
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
    raise exception using
      errcode = 'P0001',
      message = 'A valid reconciliation payment-capacity reservation is required';
  end if;
  if v_reservation.payment_count <> jsonb_array_length(new.snapshot -> 'payments') then
    raise exception using
      errcode = '22023',
      message = 'The reconciliation payment count does not match its capacity reservation';
  end if;

  update public.reconciliation_usage_reservations
  set status = 'committed', reconciliation_run_id = new.id
  where id = v_reservation.id;
  return new;
end;
$$;

revoke all on function app_private.require_reconciliation_capacity() from public;

create trigger reconciliation_runs_require_capacity
after insert on public.reconciliation_runs
for each row execute function app_private.require_reconciliation_capacity();

commit;
