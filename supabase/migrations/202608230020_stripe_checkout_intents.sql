begin;

create table public.stripe_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  plan_code text not null,
  provider_price_id text not null,
  status text not null default 'creating',
  lease_hash text,
  lease_expires_at timestamptz,
  provider_session_id text,
  session_expires_at timestamptz,
  attempt_count integer not null default 1,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_checkout_intents_plan_check check (
    plan_code in ('solo', 'business', 'bookkeeper')
  ),
  constraint stripe_checkout_intents_price_check check (
    provider_price_id ~ '^price_[A-Za-z0-9_]{1,240}$'
  ),
  constraint stripe_checkout_intents_status_check check (
    status in ('creating', 'ready', 'completed', 'expired')
  ),
  constraint stripe_checkout_intents_lease_check check (
    (status = 'creating' and lease_hash is not null and lease_expires_at is not null)
    or (status <> 'creating' and lease_hash is null and lease_expires_at is null)
  ),
  constraint stripe_checkout_intents_session_check check (
    (status = 'creating' and provider_session_id is null and session_expires_at is null)
    or (
      status in ('ready', 'completed', 'expired')
      and (
        (provider_session_id is null and session_expires_at is null)
        or (
          provider_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'
          and session_expires_at is not null
        )
      )
    )
  ),
  constraint stripe_checkout_intents_attempt_check check (attempt_count between 1 and 1000),
  constraint stripe_checkout_intents_completed_check check (
    (status = 'completed') = (completed_at is not null)
  )
);

create unique index stripe_checkout_intents_active_org_uidx
on public.stripe_checkout_intents (organization_id)
where status in ('creating', 'ready');

create unique index stripe_checkout_intents_provider_session_uidx
on public.stripe_checkout_intents (provider_session_id)
where provider_session_id is not null;

create index stripe_checkout_intents_expiry_idx
on public.stripe_checkout_intents (session_expires_at)
where status = 'ready';

alter table public.stripe_checkout_intents enable row level security;
alter table public.stripe_checkout_intents force row level security;

create trigger stripe_checkout_intents_touch_updated_at
before update on public.stripe_checkout_intents
for each row execute function app_private.touch_updated_at();

create or replace function app_private.stripe_checkout_lease_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

revoke all on function app_private.stripe_checkout_lease_hash(text)
from public, anon, authenticated, service_role;

create or replace function public.reserve_stripe_checkout_intent(
  p_organization_id uuid,
  p_plan_code text,
  p_provider_price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := statement_timestamp();
  v_intent public.stripe_checkout_intents%rowtype;
  v_token text;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_organization_id is null
     or p_plan_code not in ('solo', 'business', 'bookkeeper')
     or p_provider_price_id is null
     or p_provider_price_id !~ '^price_[A-Za-z0-9_]{1,240}$' then
    raise exception using errcode = '22023', message = 'The checkout intent is invalid';
  end if;
  if not exists (
    select 1
    from public.organizations o
    join public.memberships m on m.organization_id = o.id
    where o.id = p_organization_id
      and o.status = 'active'
      and m.user_id = v_actor
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Billing administrator access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':stripe-billing', 0)
  );

  if exists (
    select 1
    from public.subscriptions s
    where s.organization_id = p_organization_id
      and s.provider_subscription_id is not null
      and s.status <> 'canceled'
  ) then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'code', 'existing_subscription'
    );
  end if;

  update public.stripe_checkout_intents
  set status = 'expired', lease_hash = null, lease_expires_at = null
  where organization_id = p_organization_id
    and status = 'ready'
    and session_expires_at <= v_now;

  update public.stripe_checkout_intents
  set status = 'expired', lease_hash = null, lease_expires_at = null
  where organization_id = p_organization_id
    and status = 'creating'
    and created_at <= v_now - interval '40 minutes';

  select intent.* into v_intent
  from public.stripe_checkout_intents intent
  where intent.organization_id = p_organization_id
    and intent.status in ('creating', 'ready')
  for update;

  if found then
    if v_intent.plan_code is distinct from p_plan_code
       or v_intent.provider_price_id is distinct from p_provider_price_id then
      return pg_catalog.jsonb_build_object(
        'allowed', false,
        'code', 'checkout_already_pending',
        'plan', v_intent.plan_code
      );
    end if;
    if v_intent.status = 'ready' then
      return pg_catalog.jsonb_build_object(
        'allowed', true,
        'status', 'ready',
        'intent_id', v_intent.id,
        'plan', v_intent.plan_code,
        'provider_price_id', v_intent.provider_price_id,
        'provider_session_id', v_intent.provider_session_id,
        'session_expires_at', v_intent.session_expires_at
      );
    end if;
    if v_intent.lease_expires_at > v_now then
      return pg_catalog.jsonb_build_object(
        'allowed', false,
        'code', 'checkout_creation_in_progress',
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_intent.lease_expires_at - v_now)))::integer)
      );
    end if;

    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    update public.stripe_checkout_intents
    set requested_by = v_actor,
        lease_hash = app_private.stripe_checkout_lease_hash(v_token),
        lease_expires_at = v_now + interval '2 minutes',
        attempt_count = least(attempt_count + 1, 1000)
    where id = v_intent.id;
    return pg_catalog.jsonb_build_object(
      'allowed', true,
      'status', 'claimed',
      'intent_id', v_intent.id,
      'lease_token', v_token,
      'plan', v_intent.plan_code,
      'provider_price_id', v_intent.provider_price_id,
      'recovered', true
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.stripe_checkout_intents (
    organization_id,
    requested_by,
    plan_code,
    provider_price_id,
    lease_hash,
    lease_expires_at
  ) values (
    p_organization_id,
    v_actor,
    p_plan_code,
    p_provider_price_id,
    app_private.stripe_checkout_lease_hash(v_token),
    v_now + interval '2 minutes'
  )
  returning * into v_intent;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'status', 'claimed',
    'intent_id', v_intent.id,
    'lease_token', v_token,
    'plan', v_intent.plan_code,
    'provider_price_id', v_intent.provider_price_id,
    'recovered', false
  );
end;
$$;

create or replace function public.complete_stripe_checkout_intent(
  p_intent_id uuid,
  p_lease_token text,
  p_provider_session_id text,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent public.stripe_checkout_intents%rowtype;
  v_organization_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required';
  end if;
  if p_intent_id is null
     or p_lease_token is null
     or p_lease_token !~ '^[0-9a-f]{64}$'
     or p_provider_session_id is null
     or p_provider_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'
     or p_session_expires_at is null
     or p_session_expires_at <= v_now
     or p_session_expires_at > v_now + interval '25 hours' then
    raise exception using errcode = '22023', message = 'The Stripe Checkout session receipt is invalid';
  end if;

  -- Resolve the immutable organization key without taking the row lock, then
  -- acquire locks in the same advisory -> row order used by reservation. This
  -- avoids a deadlock with a concurrent reservation for the same organization.
  select intent.organization_id into v_organization_id
  from public.stripe_checkout_intents intent
  where intent.id = p_intent_id;
  if not found then
    raise exception using errcode = '22023', message = 'The checkout intent does not exist';
  end if;

  -- Coordinate with the Stripe subscription event writer before accepting the
  -- external session receipt. This closes the race where a subscription webhook
  -- arrives after reservation but before Stripe session creation completes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_organization_id::text || ':stripe-billing', 0)
  );

  select intent.* into v_intent
  from public.stripe_checkout_intents intent
  where intent.id = p_intent_id
    and intent.organization_id = v_organization_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'The checkout intent does not exist';
  end if;

  if exists (
    select 1
    from public.subscriptions s
    where s.organization_id = v_intent.organization_id
      and s.provider_subscription_id is not null
      and s.status <> 'canceled'
  ) then
    update public.stripe_checkout_intents
    set status = 'expired',
        provider_session_id = p_provider_session_id,
        session_expires_at = p_session_expires_at,
        lease_hash = null,
        lease_expires_at = null
    where id = v_intent.id
      and status = 'creating';
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'status', 'rejected',
      'code', 'existing_subscription'
    );
  end if;

  if v_intent.status = 'ready'
     and v_intent.provider_session_id = p_provider_session_id
     and v_intent.session_expires_at = p_session_expires_at then
    return pg_catalog.jsonb_build_object('ok', true, 'status', 'ready', 'existing', true);
  end if;
  if v_intent.status is distinct from 'creating'
     or v_intent.lease_expires_at <= v_now
     or v_intent.lease_hash is distinct from app_private.stripe_checkout_lease_hash(p_lease_token) then
    raise exception using errcode = '42501', message = 'The checkout creation lease is invalid';
  end if;

  update public.stripe_checkout_intents
  set status = 'ready',
      provider_session_id = p_provider_session_id,
      session_expires_at = p_session_expires_at,
      lease_hash = null,
      lease_expires_at = null
  where id = v_intent.id;

  return pg_catalog.jsonb_build_object('ok', true, 'status', 'ready', 'existing', false);
end;
$$;

create or replace function public.expire_stripe_checkout_intent(
  p_intent_id uuid,
  p_provider_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required';
  end if;
  update public.stripe_checkout_intents
  set status = 'expired'
  where id = p_intent_id
    and status = 'ready'
    and provider_session_id = p_provider_session_id;
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', case when found then 'expired' else 'unchanged' end
  );
end;
$$;

create or replace function public.mark_stripe_checkout_intent_completed(
  p_organization_id uuid,
  p_provider_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required';
  end if;
  if p_organization_id is null
     or p_provider_session_id is null
     or p_provider_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$' then
    raise exception using errcode = '22023', message = 'The Stripe Checkout completion receipt is invalid';
  end if;
  update public.stripe_checkout_intents
  set status = 'completed', completed_at = statement_timestamp()
  where organization_id = p_organization_id
    and provider_session_id = p_provider_session_id
    and status = 'ready';
  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', case when found then 'completed' else 'missing' end
  );
end;
$$;

revoke all on table public.stripe_checkout_intents
from public, anon, authenticated, service_role;
revoke all on function public.reserve_stripe_checkout_intent(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.complete_stripe_checkout_intent(uuid, text, text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.expire_stripe_checkout_intent(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.mark_stripe_checkout_intent_completed(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.reserve_stripe_checkout_intent(uuid, text, text)
to authenticated;
grant execute on function public.complete_stripe_checkout_intent(uuid, text, text, timestamptz)
to service_role;
grant execute on function public.expire_stripe_checkout_intent(uuid, text)
to service_role;
grant execute on function public.mark_stripe_checkout_intent_completed(uuid, text)
to service_role;

comment on table public.stripe_checkout_intents is
  'Minimal per-organization Stripe Checkout lease and opaque session receipt. No checkout URL, payment method, card, or billing payload is retained.';
comment on function public.reserve_stripe_checkout_intent(uuid, text, text) is
  'Billing-admin-only atomic lease that prevents concurrent subscription Checkout sessions for one organization and rejects existing subscriptions.';

commit;
