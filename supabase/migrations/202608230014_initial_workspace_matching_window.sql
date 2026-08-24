begin;

update public.workspaces
set match_days_after = greatest(1, least(365, match_days_after))
where match_days_after not between 1 and 365;

alter table public.workspaces drop constraint if exists workspaces_window_check;
alter table public.workspaces add constraint workspaces_window_check check (
  match_days_before between 0 and 365 and match_days_after between 1 and 365
);

drop function if exists public.create_initial_workspace(text, text, text, text, text);

create function public.create_initial_workspace(
  p_business_name text,
  p_organization_type text default 'business',
  p_currency_code text default 'USD',
  p_timezone text default 'UTC',
  p_accounting_basis text default null,
  p_match_days_after smallint default 90
)
returns table (organization_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_organization_id uuid;
  existing_workspace_id uuid;
  created_organization_id uuid;
  created_workspace_id uuid;
begin
  if actor_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if char_length(btrim(p_business_name)) not between 2 and 200 then raise exception using errcode = '22023', message = 'Business name is invalid'; end if;
  if p_organization_type not in ('business', 'bookkeeping_firm', 'accounting_firm') then raise exception using errcode = '22023', message = 'Organization type is invalid'; end if;
  if p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$' then raise exception using errcode = '22023', message = 'Currency is invalid'; end if;
  if nullif(btrim(p_timezone), '') is null or char_length(btrim(p_timezone)) > 100 or not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = btrim(p_timezone)
  ) then raise exception using errcode = '22023', message = 'Timezone is invalid'; end if;
  if p_accounting_basis is not null and p_accounting_basis not in ('cash', 'accrual') then raise exception using errcode = '22023', message = 'Accounting basis is invalid'; end if;
  if p_match_days_after is null or p_match_days_after not between 1 and 365 then raise exception using errcode = '22023', message = 'Matching date window is invalid'; end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text, 0));
  select o.id, w.id into existing_organization_id, existing_workspace_id
  from public.organizations o
  join public.memberships m on m.organization_id = o.id and m.user_id = actor_id and m.status = 'active'
  join public.workspaces w on w.organization_id = o.id and w.status = 'active'
  where o.created_by = actor_id
  order by o.created_at, w.created_at
  limit 1;
  if existing_workspace_id is not null then
    return query select existing_organization_id, existing_workspace_id;
    return;
  end if;

  insert into public.organizations (name, organization_type, created_by)
  values (btrim(p_business_name), p_organization_type, actor_id)
  returning id into created_organization_id;
  insert into public.memberships (organization_id, user_id, role, status, joined_at)
  values (created_organization_id, actor_id, 'owner', 'active', now());
  insert into public.workspaces (
    organization_id, name, business_name, accounting_basis, currency_code,
    timezone, match_days_after, created_by
  )
  values (
    created_organization_id, btrim(p_business_name), btrim(p_business_name),
    p_accounting_basis, upper(p_currency_code), btrim(p_timezone),
    p_match_days_after, actor_id
  )
  returning id into created_workspace_id;
  insert into public.subscriptions (organization_id, plan_code, status, unit_amount_minor, billing_interval)
  values (created_organization_id, 'free', 'active', 0, 'month');
  return query select created_organization_id, created_workspace_id;
end;
$$;

revoke all on function public.create_initial_workspace(text, text, text, text, text, smallint) from public, anon;
grant execute on function public.create_initial_workspace(text, text, text, text, text, smallint) to authenticated;

commit;
