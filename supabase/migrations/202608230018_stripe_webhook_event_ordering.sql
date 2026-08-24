begin;

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  event_precedence smallint not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_subscription_id text not null,
  outcome text not null default 'pending',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stripe_webhook_events_id_check check (
    event_id ~ '^evt_[A-Za-z0-9_]{1,200}$'
  ),
  constraint stripe_webhook_events_type_precedence_check check (
    (event_type = 'checkout.session.completed' and event_precedence = 10)
    or (event_type = 'customer.subscription.created' and event_precedence = 20)
    or (event_type = 'customer.subscription.updated' and event_precedence = 30)
    or (event_type = 'customer.subscription.deleted' and event_precedence = 100)
  ),
  constraint stripe_webhook_events_subscription_check check (
    char_length(btrim(provider_subscription_id)) between 1 and 255
  ),
  constraint stripe_webhook_events_outcome_check check (
    outcome in ('pending', 'applied', 'stale')
  ),
  constraint stripe_webhook_events_processed_check check (
    (outcome = 'pending' and processed_at is null)
    or (outcome in ('applied', 'stale') and processed_at is not null)
  )
);

create index stripe_webhook_events_org_created_idx
on public.stripe_webhook_events (organization_id, event_created_at desc, event_precedence desc, event_id desc);

create index stripe_webhook_events_received_idx
on public.stripe_webhook_events (received_at desc);

alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_webhook_events force row level security;

alter table public.subscriptions
  add column last_stripe_event_created_at timestamptz,
  add column last_stripe_event_precedence smallint,
  add column last_stripe_event_id text;

alter table public.subscriptions
  add constraint subscriptions_stripe_event_cursor_check check (
    (
      last_stripe_event_created_at is null
      and last_stripe_event_precedence is null
      and last_stripe_event_id is null
    )
    or (
      last_stripe_event_created_at is not null
      and last_stripe_event_precedence is not null
      and last_stripe_event_precedence between 10 and 100
      and last_stripe_event_id is not null
      and char_length(btrim(last_stripe_event_id)) between 1 and 255
    )
  );

-- Existing rows predate the event ledger. Their last database update is a safe
-- lower bound: an older delayed event must not replace the state already shown.
update public.subscriptions
set
  last_stripe_event_created_at = updated_at,
  last_stripe_event_precedence = case when status = 'canceled' then 100 else 30 end,
  last_stripe_event_id = 'legacy:' || id::text
where provider_subscription_id is not null;

create or replace function public.apply_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_price_id text,
  p_plan_code text,
  p_status text,
  p_unit_amount_minor bigint,
  p_quantity integer,
  p_currency_code text,
  p_billing_interval text,
  p_paid_started_at timestamptz,
  p_trial_ends_at timestamptz,
  p_current_period_starts_at timestamptz,
  p_current_period_ends_at timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_precedence smallint;
  v_inserted_event_id text;
  v_existing_event public.stripe_webhook_events%rowtype;
  v_current_subscription public.subscriptions%rowtype;
  v_has_current_subscription boolean;
  v_effective_status text;
  v_effective_canceled_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required';
  end if;

  v_event_precedence := case p_event_type
    when 'checkout.session.completed' then 10
    when 'customer.subscription.created' then 20
    when 'customer.subscription.updated' then 30
    when 'customer.subscription.deleted' then 100
    else null
  end;

  if p_event_id is null
    or p_event_id !~ '^evt_[A-Za-z0-9_]{1,200}$'
    or v_event_precedence is null
    or p_event_created_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid Stripe event identity';
  end if;
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'Organization is required';
  end if;
  if p_provider_customer_id is null
    or char_length(btrim(p_provider_customer_id)) not between 1 and 255
    or p_provider_subscription_id is null
    or char_length(btrim(p_provider_subscription_id)) not between 1 and 255
    or p_provider_price_id is null
    or char_length(btrim(p_provider_price_id)) not between 1 and 255
  then
    raise exception using errcode = '22023', message = 'Invalid Stripe subscription identity';
  end if;
  if p_plan_code is null
    or p_plan_code not in ('solo', 'business', 'bookkeeper')
    or p_status is null
    or p_status not in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
    or p_unit_amount_minor is null
    or p_unit_amount_minor < 0
    or p_quantity is null
    or p_quantity <= 0
    or p_currency_code is null
    or p_currency_code !~ '^[A-Z]{3}$'
    or p_billing_interval is null
    or p_billing_interval not in ('month', 'year')
    or p_cancel_at_period_end is null
  then
    raise exception using errcode = '22023', message = 'Invalid Stripe subscription state';
  end if;

  v_effective_status := case
    when p_event_type = 'customer.subscription.deleted' then 'canceled'
    else p_status
  end;
  v_effective_canceled_at := case
    when p_event_type = 'customer.subscription.deleted' then coalesce(p_canceled_at, p_event_created_at)
    else p_canceled_at
  end;

  -- Serialize every subscription transition for an organization, including the
  -- first row, where there is no subscription tuple available to lock yet. The
  -- Checkout reservation boundary uses this same key so a webhook cannot race
  -- an existing-subscription check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':stripe-billing', 0)
  );

  insert into public.stripe_webhook_events (
    event_id,
    event_type,
    event_created_at,
    event_precedence,
    organization_id,
    provider_subscription_id,
    outcome
  ) values (
    p_event_id,
    p_event_type,
    p_event_created_at,
    v_event_precedence,
    p_organization_id,
    p_provider_subscription_id,
    'pending'
  )
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    select e.* into v_existing_event
    from public.stripe_webhook_events e
    where e.event_id = p_event_id;

    if not found
      or v_existing_event.event_type is distinct from p_event_type
      or v_existing_event.event_created_at is distinct from p_event_created_at
      or v_existing_event.organization_id is distinct from p_organization_id
      or v_existing_event.provider_subscription_id is distinct from p_provider_subscription_id
      or v_existing_event.outcome not in ('applied', 'stale')
    then
      raise exception using errcode = '22023', message = 'Stripe event identity conflict';
    end if;

    return pg_catalog.jsonb_build_object('ok', true, 'outcome', 'duplicate');
  end if;

  select s.* into v_current_subscription
  from public.subscriptions s
  where s.organization_id = p_organization_id
  for update;
  v_has_current_subscription := found;

  if v_has_current_subscription
    and v_current_subscription.provider_subscription_id is not null
    and v_current_subscription.provider_subscription_id is distinct from p_provider_subscription_id
    and p_event_type in ('customer.subscription.updated', 'customer.subscription.deleted')
  then
    update public.stripe_webhook_events
    set outcome = 'stale', processed_at = now()
    where event_id = p_event_id;
    return pg_catalog.jsonb_build_object('ok', true, 'outcome', 'stale');
  end if;

  if v_has_current_subscription
    and v_current_subscription.last_stripe_event_created_at is not null
    and row(p_event_created_at, v_event_precedence, p_event_id)
      <= row(
        v_current_subscription.last_stripe_event_created_at,
        v_current_subscription.last_stripe_event_precedence,
        v_current_subscription.last_stripe_event_id
      )
  then
    update public.stripe_webhook_events
    set outcome = 'stale', processed_at = now()
    where event_id = p_event_id;
    return pg_catalog.jsonb_build_object('ok', true, 'outcome', 'stale');
  end if;

  insert into public.subscriptions (
    organization_id,
    provider,
    provider_customer_id,
    provider_subscription_id,
    provider_price_id,
    plan_code,
    status,
    unit_amount_minor,
    quantity,
    currency_code,
    billing_interval,
    paid_started_at,
    trial_ends_at,
    current_period_starts_at,
    current_period_ends_at,
    cancel_at_period_end,
    canceled_at,
    last_stripe_event_created_at,
    last_stripe_event_precedence,
    last_stripe_event_id,
    updated_at
  ) values (
    p_organization_id,
    'stripe',
    p_provider_customer_id,
    p_provider_subscription_id,
    p_provider_price_id,
    p_plan_code,
    v_effective_status,
    p_unit_amount_minor,
    p_quantity,
    p_currency_code,
    p_billing_interval,
    p_paid_started_at,
    p_trial_ends_at,
    p_current_period_starts_at,
    p_current_period_ends_at,
    p_cancel_at_period_end,
    v_effective_canceled_at,
    p_event_created_at,
    v_event_precedence,
    p_event_id,
    now()
  )
  on conflict (organization_id) do update set
    provider = excluded.provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    provider_price_id = excluded.provider_price_id,
    plan_code = excluded.plan_code,
    status = excluded.status,
    unit_amount_minor = excluded.unit_amount_minor,
    quantity = excluded.quantity,
    currency_code = excluded.currency_code,
    billing_interval = excluded.billing_interval,
    paid_started_at = excluded.paid_started_at,
    trial_ends_at = excluded.trial_ends_at,
    current_period_starts_at = excluded.current_period_starts_at,
    current_period_ends_at = excluded.current_period_ends_at,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at,
    last_stripe_event_created_at = excluded.last_stripe_event_created_at,
    last_stripe_event_precedence = excluded.last_stripe_event_precedence,
    last_stripe_event_id = excluded.last_stripe_event_id,
    updated_at = excluded.updated_at;

  update public.stripe_webhook_events
  set outcome = 'applied', processed_at = now()
  where event_id = p_event_id;

  return pg_catalog.jsonb_build_object('ok', true, 'outcome', 'applied');
end;
$$;

revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role;
revoke all on function public.apply_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, bigint, integer,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.apply_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, bigint, integer,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, timestamptz
) to service_role;

comment on table public.stripe_webhook_events is
  'Minimal Stripe event ledger. No payload is retained; only the atomic ordering cursor and processing outcome are stored.';
comment on function public.apply_stripe_subscription_event(
  text, text, timestamptz, uuid, text, text, text, text, text, bigint, integer,
  text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, timestamptz
) is
  'Service-role-only atomic Stripe event ledger and subscription state transition. Equal-second deletion events have highest precedence.';

commit;
