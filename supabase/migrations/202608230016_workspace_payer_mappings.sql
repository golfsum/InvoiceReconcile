begin;

-- Payer mappings affect financial suggestions, so browser clients must use the
-- audited functions below instead of composing alias and audit writes separately.
revoke insert, update, delete on public.payer_aliases from authenticated;

-- Migration 015 defines the same name normalization used by the TypeScript
-- engine. Re-key existing aliases before any live matcher consumes them.
drop index if exists public.payer_aliases_active_value_uidx;

with normalized as (
  select
    a.id,
    a.is_active as was_active,
    app_private.normalize_record_name(a.alias) as normalized_alias
  from public.payer_aliases a
), changed as (
  update public.payer_aliases a
  set
    normalized_alias = case
      when n.normalized_alias = '' then 'INACTIVE ' || a.id::text
      else n.normalized_alias
    end,
    is_active = case when n.normalized_alias = '' then false else a.is_active end
  from normalized n
  where a.id = n.id
  returning a.id, a.workspace_id, a.alias, n.normalized_alias, n.was_active
)
insert into public.audit_events (
  organization_id, workspace_id, actor_user_id, actor_type,
  event_type, entity_type, entity_id, metadata
)
select
  w.organization_id, d.workspace_id, null, 'system',
  'payer_mapping.invalid_deactivated', 'payer_alias', d.id,
  jsonb_build_object(
    'alias', d.alias,
    'reason', 'The normalized payer name contained no usable identity tokens.'
  )
from changed d
join public.workspaces w on w.id = d.workspace_id
where d.was_active and d.normalized_alias = '';

-- If earlier writes created behaviorally equivalent aliases, keep the oldest
-- confirmed rule and deactivate every conflicting row with an immutable audit.
with ranked as (
  select
    a.id,
    a.workspace_id,
    a.alias,
    a.normalized_alias,
    a.customer_id,
    pg_catalog.first_value(a.id) over (
      partition by a.workspace_id, a.normalized_alias
      order by a.confirmed_at nulls last, a.created_at, a.id
    ) as winner_id,
    pg_catalog.row_number() over (
      partition by a.workspace_id, a.normalized_alias
      order by a.confirmed_at nulls last, a.created_at, a.id
    ) as rule_rank
  from public.payer_aliases a
  where a.is_active
), deactivated as (
  update public.payer_aliases a
  set is_active = false
  from ranked r
  where a.id = r.id
    and r.rule_rank > 1
  returning a.id, a.workspace_id, a.alias, a.normalized_alias, a.customer_id, r.winner_id
)
insert into public.audit_events (
  organization_id, workspace_id, actor_user_id, actor_type,
  event_type, entity_type, entity_id, metadata
)
select
  w.organization_id, d.workspace_id, null, 'system',
  'payer_mapping.conflict_deactivated', 'payer_alias', d.id,
  jsonb_build_object(
    'alias', d.alias,
    'normalized_alias', d.normalized_alias,
    'customer_id', d.customer_id,
    'kept_rule_id', d.winner_id,
    'reason', 'A single normalized payer can map to only one active customer per workspace.'
  )
from deactivated d
join public.workspaces w on w.id = d.workspace_id;

create unique index payer_aliases_active_value_uidx
on public.payer_aliases (workspace_id, normalized_alias)
where is_active;

create or replace function public.create_workspace_payer_mapping(
  p_workspace_id uuid,
  p_alias text,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_customer_name text;
  v_normalized_alias text;
  v_existing public.payer_aliases%rowtype;
  v_alias public.payer_aliases%rowtype;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_alias is null or char_length(btrim(p_alias)) not between 2 and 200 then
    raise exception using errcode = '22023', message = 'Enter a payer name between 2 and 200 characters';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id
    and w.status = 'active';
  if v_organization_id is null or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;

  select c.name into v_customer_name
  from public.customers c
  where c.id = p_customer_id
    and c.workspace_id = p_workspace_id
    and c.status = 'active';
  if v_customer_name is null then
    raise exception using errcode = '22023', message = 'Choose an active customer from this workspace';
  end if;

  v_normalized_alias := nullif(app_private.normalize_record_name(p_alias), '');
  if v_normalized_alias is null then
    raise exception using errcode = '22023', message = 'Enter a payer name with letters or numbers';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':payer-alias:' || v_normalized_alias, 0)
  );
  select a.* into v_existing
  from public.payer_aliases a
  where a.workspace_id = p_workspace_id
    and a.normalized_alias = v_normalized_alias
    and a.is_active
  order by a.created_at
  limit 1
  for update;

  if v_existing.id is not null then
    if v_existing.customer_id <> p_customer_id then
      raise exception using errcode = '23505', message = 'This payer is already mapped to another customer';
    end if;
    return jsonb_build_object(
      'existing', true,
      'rule', jsonb_build_object(
        'id', v_existing.id,
        'alias', v_existing.alias,
        'normalizedAlias', v_existing.normalized_alias,
        'customerId', v_existing.customer_id,
        'customerName', v_customer_name,
        'matchType', v_existing.match_type,
        'createdAt', v_existing.created_at
      )
    );
  end if;

  insert into public.payer_aliases (
    workspace_id,
    customer_id,
    alias,
    normalized_alias,
    match_type,
    is_active,
    confirmed_by,
    confirmed_at
  ) values (
    p_workspace_id,
    p_customer_id,
    btrim(p_alias),
    v_normalized_alias,
    'exact_normalized',
    true,
    v_actor,
    now()
  ) returning * into v_alias;

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
    v_organization_id,
    p_workspace_id,
    v_actor,
    'user',
    'payer_mapping.created',
    'payer_alias',
    v_alias.id,
    jsonb_build_object(
      'alias', v_alias.alias,
      'normalized_alias', v_alias.normalized_alias,
      'customer_id', p_customer_id,
      'customer_name', v_customer_name,
      'match_type', v_alias.match_type,
      'influence', 'identity_evidence_only'
    )
  );

  return jsonb_build_object(
    'existing', false,
    'rule', jsonb_build_object(
      'id', v_alias.id,
      'alias', v_alias.alias,
      'normalizedAlias', v_alias.normalized_alias,
      'customerId', v_alias.customer_id,
      'customerName', v_customer_name,
      'matchType', v_alias.match_type,
      'createdAt', v_alias.created_at
    )
  );
end;
$$;

create or replace function public.delete_workspace_payer_mapping(
  p_workspace_id uuid,
  p_rule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_customer_name text;
  v_alias public.payer_aliases%rowtype;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;

  select a, w.organization_id, c.name
  into v_alias, v_organization_id, v_customer_name
  from public.payer_aliases a
  join public.workspaces w
    on w.id = a.workspace_id
  join public.customers c
    on c.id = a.customer_id
    and c.workspace_id = a.workspace_id
  where a.id = p_rule_id
    and a.workspace_id = p_workspace_id
    and w.status = 'active'
  for update of a;
  if not found or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;

  if not v_alias.is_active then
    return jsonb_build_object('ruleId', v_alias.id, 'deleted', true, 'existing', true);
  end if;

  update public.payer_aliases
  set is_active = false
  where id = v_alias.id
    and workspace_id = p_workspace_id;

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
    v_organization_id,
    p_workspace_id,
    v_actor,
    'user',
    'payer_mapping.deleted',
    'payer_alias',
    v_alias.id,
    jsonb_build_object(
      'alias', v_alias.alias,
      'normalized_alias', v_alias.normalized_alias,
      'customer_id', v_alias.customer_id,
      'customer_name', v_customer_name,
      'match_type', v_alias.match_type,
      'influence', 'removed_from_future_runs'
    )
  );

  return jsonb_build_object('ruleId', v_alias.id, 'deleted', true, 'existing', false);
end;
$$;

create or replace function public.update_workspace_payer_mapping(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_alias text,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_customer_name text;
  v_normalized_alias text;
  v_existing_id uuid;
  v_alias public.payer_aliases%rowtype;
  v_previous_alias text;
  v_previous_normalized_alias text;
  v_previous_customer_id uuid;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_alias is null or char_length(btrim(p_alias)) not between 2 and 200 then
    raise exception using errcode = '22023', message = 'Enter a payer name between 2 and 200 characters';
  end if;

  select a.*, w.organization_id
  into v_alias, v_organization_id
  from public.payer_aliases a
  join public.workspaces w on w.id = a.workspace_id
  where a.id = p_rule_id
    and a.workspace_id = p_workspace_id
    and a.is_active
    and w.status = 'active'
  for update of a;
  if not found or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;

  select c.name into v_customer_name
  from public.customers c
  where c.id = p_customer_id
    and c.workspace_id = p_workspace_id
    and c.status = 'active';
  if v_customer_name is null then
    raise exception using errcode = '22023', message = 'Choose an active customer from this workspace';
  end if;

  v_normalized_alias := nullif(app_private.normalize_record_name(p_alias), '');
  if v_normalized_alias is null then
    raise exception using errcode = '22023', message = 'Enter a payer name with letters or numbers';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':payer-alias:' || v_normalized_alias, 0)
  );
  select a.id into v_existing_id
  from public.payer_aliases a
  where a.workspace_id = p_workspace_id
    and a.normalized_alias = v_normalized_alias
    and a.is_active
    and a.id <> p_rule_id
  order by a.created_at
  limit 1;
  if v_existing_id is not null then
    raise exception using errcode = '23505', message = 'This payer already has an active mapping';
  end if;

  if v_alias.alias = btrim(p_alias)
     and v_alias.normalized_alias = v_normalized_alias
     and v_alias.customer_id = p_customer_id then
    return jsonb_build_object(
      'existing', true,
      'rule', jsonb_build_object(
        'id', v_alias.id,
        'alias', v_alias.alias,
        'normalizedAlias', v_alias.normalized_alias,
        'customerId', v_alias.customer_id,
        'customerName', v_customer_name,
        'matchType', v_alias.match_type,
        'createdAt', v_alias.created_at
      )
    );
  end if;

  v_previous_alias := v_alias.alias;
  v_previous_normalized_alias := v_alias.normalized_alias;
  v_previous_customer_id := v_alias.customer_id;

  update public.payer_aliases
  set
    alias = btrim(p_alias),
    normalized_alias = v_normalized_alias,
    customer_id = p_customer_id,
    confirmed_by = v_actor,
    confirmed_at = now()
  where id = p_rule_id
    and workspace_id = p_workspace_id
  returning * into v_alias;

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
    v_organization_id,
    p_workspace_id,
    v_actor,
    'user',
    'payer_mapping.updated',
    'payer_alias',
    v_alias.id,
    jsonb_build_object(
      'previous_alias', v_previous_alias,
      'previous_normalized_alias', v_previous_normalized_alias,
      'previous_customer_id', v_previous_customer_id,
      'alias', v_alias.alias,
      'normalized_alias', v_alias.normalized_alias,
      'customer_id', v_alias.customer_id,
      'customer_name', v_customer_name,
      'match_type', v_alias.match_type,
      'influence', 'identity_evidence_only'
    )
  );

  return jsonb_build_object(
    'existing', false,
    'rule', jsonb_build_object(
      'id', v_alias.id,
      'alias', v_alias.alias,
      'normalizedAlias', v_alias.normalized_alias,
      'customerId', v_alias.customer_id,
      'customerName', v_customer_name,
      'matchType', v_alias.match_type,
      'createdAt', v_alias.created_at
    )
  );
end;
$$;

revoke all on function public.create_workspace_payer_mapping(uuid, text, uuid) from public, anon;
revoke all on function public.delete_workspace_payer_mapping(uuid, uuid) from public, anon;
revoke all on function public.update_workspace_payer_mapping(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_workspace_payer_mapping(uuid, text, uuid) to authenticated;
grant execute on function public.delete_workspace_payer_mapping(uuid, uuid) to authenticated;
grant execute on function public.update_workspace_payer_mapping(uuid, uuid, text, uuid) to authenticated;

commit;
