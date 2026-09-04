begin;

-- A leftover reservation for the same run key used to abort retries when the
-- billable payment count changed after canonicalization. Realign the reserved
-- count instead of failing closed, and keep period dates as calendar strings
-- so capacity RPC clients can parse them.
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

revoke all on function public.reserve_reconciliation_capacity(uuid, text, text, bigint)
from public, anon;
grant execute on function public.reserve_reconciliation_capacity(uuid, text, text, bigint)
to authenticated;

-- Operational metrics must not roll back a saved financial run.
create or replace function app_private.record_completed_run_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto_matched bigint;
  v_sent_to_review bigint;
begin
  if new.event_type <> 'reconciliation_run.completed' or new.entity_id is null then
    return new;
  end if;

  select
    count(*) filter (where m.confidence_category in ('exact', 'high')),
    count(*) filter (where m.confidence_category in ('review', 'unmatched'))
  into v_auto_matched, v_sent_to_review
  from public.matches m
  where m.workspace_id = new.workspace_id
    and m.reconciliation_run_id = new.entity_id;

  begin
    insert into public.usage_records (
      organization_id, workspace_id, metric_code, period_start, period_end,
      quantity, source_event_id
    ) values
      (new.organization_id, new.workspace_id, 'auto_matched', current_date, current_date,
        coalesce(v_auto_matched, 0), 'reconciliation-run:' || new.entity_id::text || ':auto-matched'),
      (new.organization_id, new.workspace_id, 'sent_to_review', current_date, current_date,
        coalesce(v_sent_to_review, 0), 'reconciliation-run:' || new.entity_id::text || ':sent-to-review')
    on conflict (organization_id, source_event_id) where source_event_id is not null do nothing;
  exception
    when others then null;
  end;

  begin
    insert into public.analytics_events (
      event_name, user_id, organization_id, workspace_id, path, properties
    ) values (
      'reconciliation_completed', new.actor_user_id, new.organization_id, new.workspace_id,
      '/app', jsonb_build_object('source', 'in_app')
    );
  exception
    when others then null;
  end;
  return new;
end;
$$;

revoke all on function app_private.record_completed_run_metrics() from public;

commit;
