begin;

alter table public.memberships
add column invitation_expires_at timestamptz;

alter table public.memberships
add column invitation_delivery_id uuid;

update public.memberships
set invitation_expires_at = coalesce(invited_at, created_at, now()) + interval '7 days'
where status = 'invited'
  and invitation_expires_at is null;

create index memberships_pending_invitation_idx
on public.memberships (lower(invited_email), invitation_expires_at)
where status = 'invited' and user_id is null and invited_email is not null;

-- Organization membership changes affect tenant access. Browser clients use the
-- audited functions below instead of composing membership writes directly.
revoke insert, delete on public.memberships from authenticated;
revoke update on public.memberships from authenticated;
revoke update (user_id, invited_email, role, status, invited_by, invited_at, joined_at, invitation_expires_at, invitation_delivery_id) on public.memberships from authenticated;

-- A regular member can inspect their own role, while owners and admins can use
-- the team RPC below. This keeps pending invitation addresses out of ordinary
-- member and viewer queries against the base table.
drop policy if exists memberships_select_org_member_or_admin on public.memberships;
create policy memberships_select_self_or_org_admin on public.memberships
for select to authenticated
using (
  user_id = auth.uid()
  or app_private.has_org_role(organization_id, array['owner', 'admin'])
  or app_private.is_internal_admin()
);

create or replace function public.get_organization_team(p_organization_id uuid)
returns table (
  membership_id uuid,
  member_email text,
  display_name text,
  member_role text,
  member_status text,
  invited_at timestamptz,
  joined_at timestamptz,
  invitation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.has_org_role(p_organization_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'Organization administration access is required';
  end if;

  return query
  select
    m.id,
    coalesce(p.email, m.invited_email),
    p.display_name,
    m.role,
    case
      when m.status = 'invited'
        and (m.invitation_expires_at is null or m.invitation_expires_at <= now() or m.role not in ('member', 'viewer'))
        then 'expired'
      else m.status
    end,
    m.invited_at,
    m.joined_at,
    m.invitation_expires_at
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id
  order by
    case m.role when 'owner' then 1 when 'admin' then 2 when 'member' then 3 else 4 end,
    lower(coalesce(p.email, m.invited_email));
end;
$$;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_organization_name text;
  v_plan_code text := 'free';
  v_existing public.memberships%rowtype;
  v_membership public.memberships%rowtype;
  v_delivery_id uuid := gen_random_uuid();
  v_had_usable_invitation boolean := false;
  v_event_type text := 'team.invitation_created';
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_role is null or p_role not in ('member', 'viewer') then
    raise exception using errcode = '22023', message = 'Choose the member or viewer role';
  end if;
  if char_length(v_email) not between 3 and 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid colleague email address';
  end if;

  select o.name into v_organization_name
  from public.organizations o
  where o.id = p_organization_id
    and o.status = 'active';
  if v_organization_name is null
     or not app_private.has_org_role(p_organization_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'Organization administration access is required';
  end if;

  select lower(p.email) into v_actor_email
  from public.profiles p
  where p.id = v_actor;
  if v_actor_email = v_email then
    raise exception using errcode = '22023', message = 'You already belong to this organization';
  end if;

  select s.plan_code into v_plan_code
  from public.subscriptions s
  where s.organization_id = p_organization_id
    and s.status in ('active', 'trialing', 'past_due')
  for update;
  v_plan_code := coalesce(v_plan_code, 'free');
  if v_plan_code not in ('business', 'bookkeeper') then
    raise exception using errcode = 'P0001', message = 'Team invitations require the Business or Bookkeeper plan';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':team-invite:' || v_email, 0)
  );

  select m.* into v_existing
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id
    and (
      lower(coalesce(m.invited_email, '')) = v_email
      or lower(coalesce(p.email, '')) = v_email
    )
  order by m.created_at
  limit 1
  for update of m;

  if v_existing.id is not null and v_existing.user_id is not null then
    if v_existing.status = 'active' then
      raise exception using errcode = '23505', message = 'This colleague already belongs to the organization';
    end if;
    raise exception using errcode = '42501', message = 'This membership cannot be invited';
  end if;

  if v_existing.id is not null then
    v_had_usable_invitation := v_existing.status = 'invited'
      and v_existing.role in ('member', 'viewer')
      and coalesce(v_existing.invitation_expires_at > now(), false);
    update public.memberships
    set
      role = p_role,
      status = 'invited',
      invited_email = v_email,
      invited_by = v_actor,
      invited_at = now(),
      invitation_expires_at = now() + interval '7 days',
      invitation_delivery_id = v_delivery_id
    where id = v_existing.id
      and organization_id = p_organization_id
    returning * into v_membership;
    v_event_type := case
      when v_had_usable_invitation then 'team.invitation_resent'
      else 'team.invitation_renewed'
    end;
  else
    insert into public.memberships (
      organization_id,
      invited_email,
      role,
      status,
      invited_by,
      invited_at,
      invitation_expires_at,
      invitation_delivery_id
    ) values (
      p_organization_id,
      v_email,
      p_role,
      'invited',
      v_actor,
      now(),
      now() + interval '7 days',
      v_delivery_id
    ) returning * into v_membership;
  end if;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    v_actor,
    'user',
    v_event_type,
    'membership',
    v_membership.id,
    jsonb_build_object(
      'role', v_membership.role,
      'expires_at', v_membership.invitation_expires_at
    )
  );

  return jsonb_build_object(
    'membershipId', v_membership.id,
    'organizationId', p_organization_id,
    'organizationName', v_organization_name,
    'invitedEmail', v_membership.invited_email,
    'role', v_membership.role,
    'status', v_membership.status,
    'invitedAt', v_membership.invited_at,
    'expiresAt', v_membership.invitation_expires_at,
    'deliveryId', v_delivery_id,
    'existing', v_had_usable_invitation
  );
end;
$$;

create or replace function public.rollback_organization_invitation_delivery(
  p_organization_id uuid,
  p_membership_id uuid,
  p_delivery_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_invitation public.memberships%rowtype;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.has_org_role(p_organization_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'Organization administration access is required';
  end if;
  if p_delivery_id is null then
    raise exception using errcode = '22023', message = 'Choose a valid invitation delivery';
  end if;

  delete from public.memberships m
  where m.id = p_membership_id
    and m.organization_id = p_organization_id
    and m.status = 'invited'
    and m.user_id is null
    and m.invitation_delivery_id = p_delivery_id
  returning * into v_invitation;

  if v_invitation.id is null then
    return jsonb_build_object('membershipId', p_membership_id, 'rolledBack', false);
  end if;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    v_actor,
    'user',
    'team.invitation_delivery_rolled_back',
    'membership',
    v_invitation.id,
    jsonb_build_object('role', v_invitation.role)
  );

  return jsonb_build_object('membershipId', v_invitation.id, 'rolledBack', true);
end;
$$;

create or replace function public.revoke_organization_invitation(
  p_organization_id uuid,
  p_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_invitation public.memberships%rowtype;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.has_org_role(p_organization_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'Organization administration access is required';
  end if;

  delete from public.memberships m
  where m.id = p_membership_id
    and m.organization_id = p_organization_id
    and m.status = 'invited'
    and m.user_id is null
  returning * into v_invitation;
  if v_invitation.id is null then
    raise exception using errcode = '22023', message = 'Choose an active team invitation';
  end if;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    actor_type,
    event_type,
    entity_type,
    entity_id,
    metadata
  ) values (
    p_organization_id,
    v_actor,
    'user',
    'team.invitation_revoked',
    'membership',
    v_invitation.id,
    jsonb_build_object('role', v_invitation.role)
  );

  return jsonb_build_object('membershipId', v_invitation.id, 'revoked', true);
end;
$$;

create or replace function public.get_my_pending_organization_invitations()
returns table (
  membership_id uuid,
  organization_id uuid,
  organization_name text,
  invited_role text,
  invitation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  select lower(u.email), u.email_confirmed_at
  into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = v_actor;
  if v_email is null or v_email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'A verified account email is required';
  end if;

  return query
  select m.id, m.organization_id, o.name, m.role, m.invitation_expires_at
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  join public.subscriptions s on s.organization_id = m.organization_id
  where m.user_id is null
    and m.status = 'invited'
    and m.role in ('member', 'viewer')
    and lower(m.invited_email) = v_email
    and m.invitation_expires_at > now()
    and o.status = 'active'
    and s.plan_code in ('business', 'bookkeeper')
    and s.status in ('active', 'trialing', 'past_due')
  order by m.invited_at;
end;
$$;

create or replace function public.accept_my_organization_invitations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_invitation record;
  v_accepted integer := 0;
  v_first_workspace_id uuid;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  select lower(u.email), u.email_confirmed_at
  into v_email, v_email_confirmed_at
  from auth.users u
  where u.id = v_actor;
  if v_email is null or v_email_confirmed_at is null then
    raise exception using errcode = '42501', message = 'A verified account email is required';
  end if;

  for v_invitation in
    select m.id, m.organization_id, m.role
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.subscriptions s on s.organization_id = m.organization_id
    where m.user_id is null
      and m.status = 'invited'
      and m.role in ('member', 'viewer')
      and lower(m.invited_email) = v_email
      and m.invitation_expires_at > now()
      and o.status = 'active'
      and s.plan_code in ('business', 'bookkeeper')
      and s.status in ('active', 'trialing', 'past_due')
    order by m.invited_at
    for update of m, s
  loop
    if exists (
      select 1
      from public.memberships existing
      where existing.organization_id = v_invitation.organization_id
        and existing.user_id = v_actor
    ) then
      delete from public.memberships where id = v_invitation.id;
      insert into public.audit_events (
        organization_id,
        actor_user_id,
        actor_type,
        event_type,
        entity_type,
        entity_id,
        metadata
      ) values (
        v_invitation.organization_id,
        v_actor,
        'user',
        'team.invitation_discarded_existing_membership',
        'membership',
        v_invitation.id,
        jsonb_build_object('role', v_invitation.role)
      );
      continue;
    end if;

    update public.memberships
    set
      user_id = v_actor,
      invited_email = null,
      status = 'active',
      joined_at = now(),
      invitation_expires_at = null,
      invitation_delivery_id = null
    where id = v_invitation.id;

    insert into public.audit_events (
      organization_id,
      actor_user_id,
      actor_type,
      event_type,
      entity_type,
      entity_id,
      metadata
    ) values (
      v_invitation.organization_id,
      v_actor,
      'user',
      'team.invitation_accepted',
      'membership',
      v_invitation.id,
      jsonb_build_object('role', v_invitation.role)
    );

    if v_first_workspace_id is null then
      select w.id into v_first_workspace_id
      from public.workspaces w
      where w.organization_id = v_invitation.organization_id
        and w.status = 'active'
      order by w.created_at
      limit 1;
    end if;
    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'workspaceId', v_first_workspace_id
  );
end;
$$;

revoke all on function public.get_organization_team(uuid) from public, anon;
revoke all on function public.create_organization_invitation(uuid, text, text) from public, anon;
revoke all on function public.rollback_organization_invitation_delivery(uuid, uuid, uuid) from public, anon;
revoke all on function public.revoke_organization_invitation(uuid, uuid) from public, anon;
revoke all on function public.get_my_pending_organization_invitations() from public, anon;
revoke all on function public.accept_my_organization_invitations() from public, anon;

grant execute on function public.get_organization_team(uuid) to authenticated;
grant execute on function public.create_organization_invitation(uuid, text, text) to authenticated;
grant execute on function public.rollback_organization_invitation_delivery(uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid, uuid) to authenticated;
grant execute on function public.get_my_pending_organization_invitations() to authenticated;
grant execute on function public.accept_my_organization_invitations() to authenticated;

commit;
