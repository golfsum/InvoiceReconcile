begin;

-- Workspace lifecycle changes must pass through the audited functions below.
-- The original tenancy migration granted direct table mutations for bootstrap
-- flows, which would otherwise let a browser client bypass plan capacity.
revoke insert, delete on public.workspaces from authenticated;
revoke update (
  name,
  business_name,
  accounting_basis,
  currency_code,
  timezone,
  match_days_before,
  match_days_after,
  status
) on public.workspaces from authenticated;
revoke delete on public.organizations from authenticated;

create or replace function public.create_additional_workspace(
  p_organization_id uuid,
  p_business_name text,
  p_currency_code text,
  p_timezone text,
  p_accounting_basis text,
  p_match_days_after integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan_code text := 'free';
  v_workspace_limit integer := 1;
  v_workspace_count integer;
  v_workspace_id uuid;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.has_org_role(p_organization_id, array['owner', 'admin', 'member']) then
    raise exception using errcode = '42501', message = 'Organization workspace access is required';
  end if;
  if p_business_name is null or char_length(btrim(p_business_name)) not between 2 and 200
     or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$'
     or nullif(btrim(p_timezone), '') is null or char_length(btrim(p_timezone)) > 100
     or not exists (
       select 1 from pg_catalog.pg_timezone_names tz
       where tz.name = btrim(p_timezone)
     )
     or p_accounting_basis is null or p_accounting_basis not in ('cash', 'accrual')
     or p_match_days_after is null or p_match_days_after not between 1 and 365 then
    raise exception using errcode = '22023', message = 'The workspace settings are invalid';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'The organization is not active';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':workspace-capacity', 0)
  );

  select s.plan_code into v_plan_code
  from public.subscriptions s
  where s.organization_id = p_organization_id
    and s.status in ('active', 'trialing', 'past_due');
  v_plan_code := coalesce(v_plan_code, 'free');
  v_workspace_limit := case v_plan_code
    when 'business' then 3
    when 'bookkeeper' then 20
    else 1
  end;

  select count(*)::integer into v_workspace_count
  from public.workspaces w
  where w.organization_id = p_organization_id
    and w.status = 'active';

  if v_workspace_count >= v_workspace_limit then
    raise exception using
      errcode = 'P0001',
      message = format('The %s plan supports %s active workspace%s', initcap(v_plan_code), v_workspace_limit, case when v_workspace_limit = 1 then '' else 's' end);
  end if;

  insert into public.workspaces (
    organization_id,
    name,
    business_name,
    accounting_basis,
    currency_code,
    timezone,
    match_days_after,
    created_by
  ) values (
    p_organization_id,
    btrim(p_business_name),
    btrim(p_business_name),
    p_accounting_basis,
    p_currency_code,
    btrim(p_timezone),
    p_match_days_after,
    v_actor
  ) returning id into v_workspace_id;

  insert into public.audit_events (
    organization_id,
    workspace_id,
    actor_user_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    v_workspace_id,
    v_actor,
    'user',
    'workspace_created',
    'workspace',
    v_workspace_id,
    jsonb_build_object('currency', p_currency_code, 'timezone', btrim(p_timezone))
  );

  return v_workspace_id;
end;
$$;

create or replace function public.update_workspace_settings(
  p_workspace_id uuid,
  p_business_name text,
  p_currency_code text,
  p_timezone text,
  p_accounting_basis text,
  p_match_days_after integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_previous jsonb;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select w.organization_id,
    jsonb_build_object(
      'businessName', w.business_name,
      'currency', w.currency_code,
      'timezone', w.timezone,
      'accountingBasis', w.accounting_basis,
      'matchDaysAfter', w.match_days_after
    )
  into v_organization_id, v_previous
  from public.workspaces w
  where w.id = p_workspace_id
    and w.status = 'active'
  for update;
  if v_organization_id is null
     or not app_private.has_org_role(v_organization_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'Workspace administration access is required';
  end if;
  if p_business_name is null or char_length(btrim(p_business_name)) not between 2 and 200
     or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$'
     or nullif(btrim(p_timezone), '') is null or char_length(btrim(p_timezone)) > 100
     or not exists (
       select 1 from pg_catalog.pg_timezone_names tz
       where tz.name = btrim(p_timezone)
     )
     or p_accounting_basis is null or p_accounting_basis not in ('cash', 'accrual')
     or p_match_days_after is null or p_match_days_after not between 1 and 365 then
    raise exception using errcode = '22023', message = 'The workspace settings are invalid';
  end if;

  update public.workspaces set
    name = btrim(p_business_name),
    business_name = btrim(p_business_name),
    currency_code = p_currency_code,
    timezone = btrim(p_timezone),
    accounting_basis = p_accounting_basis,
    match_days_after = p_match_days_after
  where id = p_workspace_id;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type,
    event_type, entity_type, entity_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'user',
    'workspace_settings_updated', 'workspace', p_workspace_id,
    jsonb_build_object(
      'previous', v_previous,
      'current', jsonb_build_object(
        'businessName', btrim(p_business_name),
        'currency', p_currency_code,
        'timezone', btrim(p_timezone),
        'accountingBasis', p_accounting_basis,
        'matchDaysAfter', p_match_days_after
      )
    )
  );
end;
$$;

create or replace function public.delete_workspace_with_audit(
  p_workspace_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace public.workspaces%rowtype;
  v_active_count integer;
  v_subscription public.subscriptions%rowtype;
  v_remaining_workspaces integer;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_confirmation is distinct from 'DELETE' then
    raise exception using errcode = '22023', message = 'Type DELETE exactly to confirm';
  end if;

  select w.* into v_workspace
  from public.workspaces w
  where w.id = p_workspace_id
    and w.status <> 'deletion_pending'
  for update;
  if not found or not app_private.has_org_role(v_workspace.organization_id, array['owner']) then
    raise exception using errcode = '42501', message = 'Only an organization owner can delete this workspace';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_workspace.organization_id::text || ':workspace-capacity', 0)
  );

  select count(*)::integer into v_active_count
  from public.workspaces w
  where w.organization_id = v_workspace.organization_id
    and w.status = 'active';
  select s.* into v_subscription
  from public.subscriptions s
  where s.organization_id = v_workspace.organization_id;
  if v_workspace.status = 'active'
     and v_active_count = 1
     and v_subscription.organization_id is not null
     and v_subscription.plan_code <> 'free'
     and v_subscription.status <> 'canceled' then
    raise exception using
      errcode = '55000',
      message = 'Cancel the paid subscription in Billing before deleting its only workspace';
  end if;

  v_remaining_workspaces := greatest(
    v_active_count - case when v_workspace.status = 'active' then 1 else 0 end,
    0
  );

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type,
    event_type, entity_type, entity_id, metadata
  ) values (
    v_workspace.organization_id, null, v_actor, 'user',
    'workspace_deleted', 'workspace', v_workspace.id,
    jsonb_build_object('workspaceId', v_workspace.id, 'workspaceName', v_workspace.name)
  );

  delete from public.workspaces where id = v_workspace.id;
  return jsonb_build_object(
    'organization_id', v_workspace.organization_id,
    'remaining_workspaces', v_remaining_workspaces
  );
end;
$$;

create index if not exists payments_workspace_import_idx
on public.payments (workspace_id, import_id)
where import_id is not null;

create or replace function public.get_workspace_portfolio_metrics()
returns table (
  workspace_id uuid,
  payments_in_latest_run bigint,
  matched_payments bigint,
  payments_needing_review bigint,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  return query
  with accessible_workspaces as (
    select w.id as target_workspace_id
    from public.workspaces w
    where w.status = 'active'
      and app_private.is_org_member(w.organization_id)
  ), latest_runs as (
    select
      aw.target_workspace_id,
      latest.id as run_id,
      latest.payment_import_id,
      latest.completed_at
    from accessible_workspaces aw
    left join lateral (
      select r.id, r.payment_import_id, r.completed_at
      from public.reconciliation_runs r
      where r.workspace_id = aw.target_workspace_id
        and r.status = 'completed'
      order by r.completed_at desc, r.id desc
      limit 1
    ) latest on true
  )
  select
    latest_runs.target_workspace_id,
    coalesce(payment_counts.imported, 0),
    coalesce(match_counts.matched, 0),
    coalesce(match_counts.needs_review, 0),
    latest_runs.completed_at
  from latest_runs
  left join lateral (
    select count(*)::bigint as imported
    from public.payments p
    where p.workspace_id = latest_runs.target_workspace_id
      and p.import_id = latest_runs.payment_import_id
  ) payment_counts on true
  left join lateral (
    select
      count(*) filter (where payment_state.is_matched)::bigint as matched,
      count(*) filter (
        where not payment_state.is_matched and payment_state.needs_review
      )::bigint as needs_review
    from (
      select
        pl.payment_id,
        pg_catalog.bool_or(
          m.status = 'approved'
          or (
            m.status = 'suggested'
            and m.confidence_category in ('exact', 'high')
          )
        ) as is_matched,
        pg_catalog.bool_or(
          m.status = 'suggested'
          and m.confidence_category in ('review', 'unmatched')
        ) as needs_review
      from public.matches m
      join public.match_payment_links pl
        on pl.workspace_id = m.workspace_id
        and pl.match_id = m.id
      where m.workspace_id = latest_runs.target_workspace_id
        and m.reconciliation_run_id = latest_runs.run_id
      group by pl.payment_id
    ) payment_state
  ) match_counts on true
  order by latest_runs.target_workspace_id;
end;
$$;

revoke all on function public.create_additional_workspace(uuid, text, text, text, text, integer) from public, anon;
revoke all on function public.update_workspace_settings(uuid, text, text, text, text, integer) from public, anon;
revoke all on function public.delete_workspace_with_audit(uuid, text) from public, anon;
revoke all on function public.get_workspace_portfolio_metrics() from public, anon;
grant execute on function public.create_additional_workspace(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.update_workspace_settings(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.delete_workspace_with_audit(uuid, text) to authenticated;
grant execute on function public.get_workspace_portfolio_metrics() to authenticated;

commit;
