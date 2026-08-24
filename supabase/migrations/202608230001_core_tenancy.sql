begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  signup_source text,
  marketing_consent boolean not null default false,
  is_internal_admin boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank check (btrim(email) <> '')
);

create unique index profiles_email_lower_uidx on public.profiles (lower(email));
create index profiles_created_at_idx on public.profiles (created_at desc);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  organization_type text not null default 'business',
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (btrim(name) <> ''),
  constraint organizations_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  constraint organizations_type_check check (organization_type in ('business', 'bookkeeping_firm', 'accounting_firm')),
  constraint organizations_status_check check (status in ('active', 'suspended', 'deletion_pending'))
);

create unique index organizations_slug_lower_uidx on public.organizations (lower(slug)) where slug is not null;
create index organizations_created_by_idx on public.organizations (created_by);
create index organizations_created_at_idx on public.organizations (created_at desc);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  invited_email text,
  role text not null,
  status text not null default 'active',
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_identity_check check (user_id is not null or invited_email is not null),
  constraint memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint memberships_status_check check (status in ('invited', 'active', 'suspended'))
);

create unique index memberships_org_user_uidx on public.memberships (organization_id, user_id) where user_id is not null;
create unique index memberships_org_invited_email_uidx on public.memberships (organization_id, lower(invited_email)) where user_id is null and invited_email is not null;
create index memberships_user_active_idx on public.memberships (user_id, organization_id) where status = 'active';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  business_name text not null,
  accounting_basis text,
  currency_code text not null default 'USD',
  timezone text not null default 'UTC',
  match_days_before smallint not null default 3,
  match_days_after smallint not null default 90,
  status text not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (btrim(name) <> '' and btrim(business_name) <> ''),
  constraint workspaces_accounting_basis_check check (accounting_basis is null or accounting_basis in ('cash', 'accrual')),
  constraint workspaces_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint workspaces_window_check check (match_days_before between 0 and 365 and match_days_after between 0 and 730),
  constraint workspaces_status_check check (status in ('active', 'archived', 'deletion_pending')),
  unique (id, organization_id)
);

create index workspaces_org_status_idx on public.workspaces (organization_id, status, created_at desc);

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.prevent_tenant_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
    raise exception using
      errcode = '42501',
      message = format('%s cannot be reassigned', tg_argv[0]);
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_authenticated_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_value text;
begin
  actor_value := to_jsonb(new) ->> tg_argv[0];
  if auth.role() = 'authenticated'
     and actor_value is not null
     and actor_value is distinct from auth.uid()::text then
    raise exception using
      errcode = '42501',
      message = format('%s must identify the authenticated user', tg_argv[0]);
  end if;
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function app_private.touch_updated_at();
create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function app_private.touch_updated_at();
create trigger memberships_touch_updated_at before update on public.memberships
for each row execute function app_private.touch_updated_at();
create trigger workspaces_touch_updated_at before update on public.workspaces
for each row execute function app_private.touch_updated_at();
create trigger memberships_prevent_org_reassignment before update on public.memberships
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger workspaces_prevent_org_reassignment before update on public.workspaces
for each row execute function app_private.prevent_tenant_reassignment('organization_id');

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, signup_source)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@unknown.invalid'),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'signup_source', '')), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function app_private.handle_new_user();

create or replace function app_private.is_internal_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_internal_admin
    from public.profiles p
    where p.id = auth.uid()
  ), false)
$$;

create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function app_private.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = target_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(allowed_roles)
  )
$$;

create or replace function app_private.can_access_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.memberships m on m.organization_id = w.organization_id
    where w.id = target_workspace_id
      and w.status <> 'deletion_pending'
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function app_private.can_edit_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.memberships m on m.organization_id = w.organization_id
    where w.id = target_workspace_id
      and w.status <> 'deletion_pending'
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'member')
  )
$$;

create or replace function app_private.can_bootstrap_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_organization_id
      and o.created_by = auth.uid()
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = target_organization_id
      )
  )
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_internal_admin() to authenticated;
grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_org_role(uuid, text[]) to authenticated;
grant execute on function app_private.can_access_workspace(uuid) to authenticated;
grant execute on function app_private.can_edit_workspace(uuid) to authenticated;
grant execute on function app_private.can_bootstrap_organization(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.workspaces enable row level security;

create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = auth.uid() or app_private.is_internal_admin());

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organizations_select_member_or_admin on public.organizations
for select to authenticated
using (app_private.is_org_member(id) or app_private.is_internal_admin());

create policy organizations_insert_creator on public.organizations
for insert to authenticated
with check (created_by = auth.uid() and status = 'active');

create policy organizations_update_org_admin on public.organizations
for update to authenticated
using (app_private.has_org_role(id, array['owner', 'admin']))
with check (app_private.has_org_role(id, array['owner', 'admin']));

create policy organizations_delete_owner on public.organizations
for delete to authenticated
using (app_private.has_org_role(id, array['owner']));

create policy memberships_select_org_member_or_admin on public.memberships
for select to authenticated
using (app_private.is_org_member(organization_id) or app_private.is_internal_admin());

create policy memberships_insert_bootstrap_or_admin on public.memberships
for insert to authenticated
with check (
  app_private.has_org_role(organization_id, array['owner'])
  or (
    app_private.has_org_role(organization_id, array['admin'])
    and role <> 'owner'
  )
  or (
    user_id = auth.uid()
    and role = 'owner'
    and status = 'active'
    and app_private.can_bootstrap_organization(organization_id)
  )
);

create policy memberships_update_org_admin on public.memberships
for update to authenticated
using (
  app_private.has_org_role(organization_id, array['owner'])
  or (app_private.has_org_role(organization_id, array['admin']) and role <> 'owner')
)
with check (
  app_private.has_org_role(organization_id, array['owner'])
  or (app_private.has_org_role(organization_id, array['admin']) and role <> 'owner')
);

create policy memberships_delete_org_admin on public.memberships
for delete to authenticated
using (
  app_private.has_org_role(organization_id, array['owner'])
  or (app_private.has_org_role(organization_id, array['admin']) and role <> 'owner')
);

create policy workspaces_select_org_member_or_admin on public.workspaces
for select to authenticated
using (app_private.is_org_member(organization_id) or app_private.is_internal_admin());

create policy workspaces_insert_org_editor on public.workspaces
for insert to authenticated
with check (
  created_by = auth.uid()
  and app_private.has_org_role(organization_id, array['owner', 'admin', 'member'])
);

create policy workspaces_update_org_admin on public.workspaces
for update to authenticated
using (app_private.has_org_role(organization_id, array['owner', 'admin']))
with check (app_private.has_org_role(organization_id, array['owner', 'admin']));

create policy workspaces_delete_org_owner on public.workspaces
for delete to authenticated
using (app_private.has_org_role(organization_id, array['owner']));

revoke all on public.profiles, public.organizations, public.memberships, public.workspaces from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, timezone, marketing_consent, last_seen_at) on public.profiles to authenticated;
grant select, insert, delete on public.organizations, public.memberships, public.workspaces to authenticated;
grant update (name, slug, organization_type, status) on public.organizations to authenticated;
grant update (user_id, invited_email, role, status, invited_by, invited_at, joined_at) on public.memberships to authenticated;
grant update (name, business_name, accounting_basis, currency_code, timezone, match_days_before, match_days_after, status) on public.workspaces to authenticated;

commit;
