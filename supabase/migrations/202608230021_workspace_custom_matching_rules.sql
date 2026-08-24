begin;

-- The original matching_rules table anticipated multiple rule shapes, including
-- regex. Live custom rules use only bounded literals and one-token templates.
-- Browser roles retain read access through RLS but all writes stay route-only.
alter table public.matching_rules
add column if not exists normalized_pattern text;

revoke insert, update, delete on public.matching_rules from authenticated;

create or replace function app_private.custom_rule_normalized_pattern(
  p_rule_type text,
  p_source_pattern text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_rule_type in ('description_pattern', 'fee_behavior')
      then app_private.normalize_record_name(p_source_pattern)
    when p_rule_type = 'reference_pattern'
      then upper(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_source_pattern, '')), '[[:space:]]+', ' ', 'g'))
    else ''
  end;
$$;

create or replace function app_private.custom_rule_source_is_ascii(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and p_value !~ '[^ -~]';
$$;

create or replace function app_private.custom_reference_template_is_valid(p_template text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_template text := app_private.custom_rule_normalized_pattern('reference_pattern', p_template);
  v_without_token text;
  v_has_digits boolean;
  v_has_alnum boolean;
  v_token_occurrences integer;
begin
  if not app_private.custom_rule_source_is_ascii(p_template) then return false; end if;
  if char_length(v_template) not between 4 and 80 then return false; end if;
  v_has_digits := pg_catalog.strpos(v_template, '{DIGITS}') > 0;
  v_has_alnum := pg_catalog.strpos(v_template, '{ALNUM}') > 0;
  if v_has_digits = v_has_alnum then return false; end if;
  v_token_occurrences := case
    when v_has_digits then
      (char_length(v_template) - char_length(pg_catalog.replace(v_template, '{DIGITS}', ''))) / char_length('{DIGITS}')
    else
      (char_length(v_template) - char_length(pg_catalog.replace(v_template, '{ALNUM}', ''))) / char_length('{ALNUM}')
  end;
  if v_token_occurrences <> 1 then return false; end if;
  v_without_token := pg_catalog.replace(
    pg_catalog.replace(v_template, '{DIGITS}', ''),
    '{ALNUM}', ''
  );
  if pg_catalog.strpos(v_without_token, '{') > 0
     or pg_catalog.strpos(v_without_token, '}') > 0
     or v_without_token ~ '[^A-Z0-9 ._/#:-]'
     or char_length(pg_catalog.regexp_replace(v_without_token, '[^A-Z0-9]', '', 'g')) < 2 then
    return false;
  end if;
  return true;
end;
$$;

create or replace function app_private.custom_rule_integer_in_range(
  p_value jsonb,
  p_minimum integer,
  p_maximum integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_number numeric;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'number' then return false; end if;
  v_text := p_value #>> '{}'::text[];
  if v_text is null or v_text !~ '^[0-9]+$' then return false; end if;
  v_number := v_text::numeric;
  return v_number between p_minimum and p_maximum;
exception when others then
  return false;
end;
$$;

create or replace function app_private.workspace_custom_rules_enabled(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organizations o on o.id = w.organization_id
    join public.subscriptions s on s.organization_id = w.organization_id
    where w.id = p_workspace_id
      and w.status = 'active'
      and o.status = 'active'
      and s.status in ('active', 'trialing', 'past_due')
      and s.plan_code in ('business', 'bookkeeper')
  );
$$;

revoke all on function app_private.custom_rule_normalized_pattern(text, text)
from public, anon, authenticated, service_role;
revoke all on function app_private.custom_rule_source_is_ascii(text)
from public, anon, authenticated, service_role;
revoke all on function app_private.custom_reference_template_is_valid(text)
from public, anon, authenticated, service_role;
revoke all on function app_private.custom_rule_integer_in_range(jsonb, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function app_private.workspace_custom_rules_enabled(uuid)
from public, anon, authenticated, service_role;

-- No released application path consumed legacy matching_rules. Deactivate any
-- pre-existing active row instead of allowing a legacy regex to become live.
with deactivated as (
  update public.matching_rules r
  set is_active = false
  where r.is_active
    and r.normalized_pattern is null
  returning r.*
)
insert into public.audit_events (
  organization_id, workspace_id, actor_user_id, actor_type,
  event_type, entity_type, entity_id, metadata
)
select
  w.organization_id, d.workspace_id, null, 'system',
  'matching_rule.legacy_deactivated', 'matching_rule', d.id,
  pg_catalog.jsonb_build_object(
    'previous_state', pg_catalog.jsonb_build_object(
      'rule_type', d.rule_type,
      'source_pattern', d.source_pattern,
      'customer_id', d.customer_id,
      'configuration', d.configuration,
      'is_active', true
    ),
    'current_state', pg_catalog.jsonb_build_object('is_active', false),
    'reason', 'Recreate this rule through the bounded custom-rule editor.'
  )
from deactivated d
join public.workspaces w on w.id = d.workspace_id;

alter table public.matching_rules
drop constraint if exists matching_rules_live_custom_shape_check;
alter table public.matching_rules
add constraint matching_rules_live_custom_shape_check check (
  not is_active
  or (
    normalized_pattern is not null
    and btrim(normalized_pattern) <> ''
    and app_private.custom_rule_source_is_ascii(source_pattern)
    and char_length(source_pattern) between 2 and 120
    and (
      (
        rule_type = 'description_pattern'
        and action_type = 'map_customer'
        and customer_id is not null
        and configuration = '{"matchMode":"contains_normalized"}'::jsonb
      )
      or (
        rule_type = 'reference_pattern'
        and action_type = 'extract_reference'
        and customer_id is null
        and configuration = '{"templateVersion":1}'::jsonb
        and app_private.custom_reference_template_is_valid(source_pattern)
      )
      or (
        rule_type = 'fee_behavior'
        and action_type = 'flag_possible_fee'
        and customer_id is null
        and configuration ?& array['maximumFeeMinor', 'maximumFeeBasisPoints']
        and configuration - 'maximumFeeMinor' - 'maximumFeeBasisPoints' = '{}'::jsonb
        and app_private.custom_rule_integer_in_range(configuration -> 'maximumFeeMinor', 1, 25000)
        and app_private.custom_rule_integer_in_range(configuration -> 'maximumFeeBasisPoints', 1, 500)
      )
    )
  )
);

create unique index if not exists matching_rules_active_pattern_uidx
on public.matching_rules (workspace_id, rule_type, normalized_pattern)
where is_active;

create index if not exists matching_rules_active_customer_idx
on public.matching_rules (workspace_id, customer_id)
where is_active and customer_id is not null;

create or replace function public.create_workspace_custom_matching_rule(
  p_workspace_id uuid,
  p_rule_type text,
  p_source_pattern text,
  p_customer_id uuid default null,
  p_maximum_fee_minor integer default null,
  p_maximum_fee_basis_points integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_normalized_pattern text;
  v_customer_name text;
  v_customer_external_id text;
  v_action_type text;
  v_configuration jsonb;
  v_name text;
  v_existing public.matching_rules%rowtype;
  v_rule public.matching_rules%rowtype;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select w.organization_id into v_organization_id
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id
  where w.id = p_workspace_id and w.status = 'active' and o.status = 'active';
  if v_organization_id is null or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;
  if not app_private.workspace_custom_rules_enabled(p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'Custom matching rules require a Business or Bookkeeper plan';
  end if;
  if p_rule_type not in ('description_pattern', 'reference_pattern', 'fee_behavior')
     or p_source_pattern is null
     or not app_private.custom_rule_source_is_ascii(p_source_pattern)
     or char_length(btrim(p_source_pattern)) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Choose a supported custom rule and use basic ASCII characters in the bounded source pattern';
  end if;

  v_normalized_pattern := app_private.custom_rule_normalized_pattern(p_rule_type, p_source_pattern);
  if p_rule_type = 'description_pattern' then
    if char_length(v_normalized_pattern) not between 4 and 120 or p_customer_id is null then
      raise exception using errcode = '22023', message = 'Enter at least four usable description characters and choose a customer';
    end if;
    select c.name, c.external_id into v_customer_name, v_customer_external_id
    from public.customers c
    where c.id = p_customer_id
      and c.workspace_id = p_workspace_id
      and c.status = 'active';
    if v_customer_name is null then
      raise exception using errcode = '22023', message = 'Choose an active customer from this workspace';
    end if;
    v_action_type := 'map_customer';
    v_configuration := '{"matchMode":"contains_normalized"}'::jsonb;
    v_name := 'Description customer mapping';
  elsif p_rule_type = 'reference_pattern' then
    if not app_private.custom_reference_template_is_valid(p_source_pattern)
       or p_customer_id is not null
       or p_maximum_fee_minor is not null
       or p_maximum_fee_basis_points is not null then
      raise exception using errcode = '22023', message = 'Use one {digits} or {alnum} token with at least two literal characters';
    end if;
    v_action_type := 'extract_reference';
    v_configuration := '{"templateVersion":1}'::jsonb;
    v_name := 'Reference extraction template';
  else
    if char_length(v_normalized_pattern) not between 4 and 120
       or p_customer_id is not null
       or p_maximum_fee_minor is null
       or p_maximum_fee_minor not between 1 and 25000
       or p_maximum_fee_basis_points is null
       or p_maximum_fee_basis_points not between 1 and 500 then
      raise exception using errcode = '22023', message = 'Enter a fee descriptor, a review cap up to 25000 minor units, and a rate up to 5 percent';
    end if;
    v_action_type := 'flag_possible_fee';
    v_configuration := pg_catalog.jsonb_build_object(
      'maximumFeeMinor', p_maximum_fee_minor,
      'maximumFeeBasisPoints', p_maximum_fee_basis_points
    );
    v_name := 'Accepted fee review behavior';
  end if;

  -- Serialize the bounded rule-count check across distinct source patterns.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':custom-rule-cap', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':custom-rule:' || p_rule_type || ':' || v_normalized_pattern, 0)
  );
  select r.* into v_existing
  from public.matching_rules r
  where r.workspace_id = p_workspace_id
    and r.rule_type = p_rule_type
    and r.normalized_pattern = v_normalized_pattern
    and r.is_active
  for update;
  if found then
    if v_existing.customer_id is not distinct from p_customer_id
       and v_existing.configuration = v_configuration then
      return pg_catalog.jsonb_build_object('existing', true, 'rule', pg_catalog.jsonb_build_object(
        'id', v_existing.id, 'kind', case v_existing.rule_type when 'description_pattern' then 'description_customer' when 'reference_pattern' then 'reference_template' else 'accepted_fee_behavior' end,
        'sourcePattern', v_existing.source_pattern, 'normalizedPattern', v_existing.normalized_pattern,
        'customerId', v_existing.customer_id, 'customerName', v_customer_name,
        'customerExternalId', v_customer_external_id,
        'maximumFeeMinor', v_existing.configuration -> 'maximumFeeMinor',
        'maximumFeeBasisPoints', v_existing.configuration -> 'maximumFeeBasisPoints',
        'createdAt', v_existing.created_at, 'updatedAt', v_existing.updated_at
      ));
    end if;
    raise exception using errcode = '23505', message = 'This source pattern already has an active custom rule';
  end if;
  if (select count(*) from public.matching_rules r where r.workspace_id = p_workspace_id and r.is_active) >= 100 then
    raise exception using errcode = '22023', message = 'A workspace can have at most 100 active custom rules';
  end if;

  insert into public.matching_rules (
    workspace_id, name, rule_type, source_pattern, normalized_pattern,
    customer_id, action_type, configuration, priority, is_active, created_by
  ) values (
    p_workspace_id, v_name, p_rule_type, btrim(p_source_pattern), v_normalized_pattern,
    p_customer_id, v_action_type, v_configuration, 100, true, v_actor
  ) returning * into v_rule;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type,
    event_type, entity_type, entity_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'user',
    'matching_rule.created', 'matching_rule', v_rule.id,
    pg_catalog.jsonb_build_object(
      'previous_state', '{}'::jsonb,
      'current_state', pg_catalog.jsonb_build_object(
        'rule_type', v_rule.rule_type, 'source_pattern', v_rule.source_pattern,
        'normalized_pattern', v_rule.normalized_pattern, 'customer_id', v_rule.customer_id,
        'configuration', v_rule.configuration, 'is_active', true
      ),
      'influence', case when p_rule_type = 'fee_behavior' then 'review_evidence_only' else 'bounded_identity_evidence' end
    )
  );

  return pg_catalog.jsonb_build_object('existing', false, 'rule', pg_catalog.jsonb_build_object(
    'id', v_rule.id, 'kind', case v_rule.rule_type when 'description_pattern' then 'description_customer' when 'reference_pattern' then 'reference_template' else 'accepted_fee_behavior' end,
    'sourcePattern', v_rule.source_pattern, 'normalizedPattern', v_rule.normalized_pattern,
    'customerId', v_rule.customer_id, 'customerName', v_customer_name,
    'customerExternalId', v_customer_external_id,
    'maximumFeeMinor', v_rule.configuration -> 'maximumFeeMinor',
    'maximumFeeBasisPoints', v_rule.configuration -> 'maximumFeeBasisPoints',
    'createdAt', v_rule.created_at, 'updatedAt', v_rule.updated_at
  ));
end;
$$;

create or replace function public.update_workspace_custom_matching_rule(
  p_workspace_id uuid,
  p_rule_id uuid,
  p_rule_type text,
  p_source_pattern text,
  p_customer_id uuid default null,
  p_maximum_fee_minor integer default null,
  p_maximum_fee_basis_points integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_previous public.matching_rules%rowtype;
  v_rule public.matching_rules%rowtype;
  v_normalized_pattern text;
  v_customer_name text;
  v_customer_external_id text;
  v_action_type text;
  v_configuration jsonb;
  v_name text;
  v_conflict_id uuid;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select r, w.organization_id into v_previous, v_organization_id
  from public.matching_rules r
  join public.workspaces w on w.id = r.workspace_id
  join public.organizations o on o.id = w.organization_id
  where r.id = p_rule_id
    and r.workspace_id = p_workspace_id
    and r.is_active
    and w.status = 'active'
    and o.status = 'active'
  for update of r;
  if not found or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;
  if not app_private.workspace_custom_rules_enabled(p_workspace_id) then
    raise exception using errcode = 'P0001', message = 'Custom matching rules require a Business or Bookkeeper plan';
  end if;
  if p_rule_type not in ('description_pattern', 'reference_pattern', 'fee_behavior')
     or p_source_pattern is null
     or not app_private.custom_rule_source_is_ascii(p_source_pattern)
     or char_length(btrim(p_source_pattern)) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'Choose a supported custom rule and use basic ASCII characters in the bounded source pattern';
  end if;

  v_normalized_pattern := app_private.custom_rule_normalized_pattern(p_rule_type, p_source_pattern);
  if p_rule_type = 'description_pattern' then
    if char_length(v_normalized_pattern) not between 4 and 120 or p_customer_id is null then
      raise exception using errcode = '22023', message = 'Enter at least four usable description characters and choose a customer';
    end if;
    select c.name, c.external_id into v_customer_name, v_customer_external_id
    from public.customers c
    where c.id = p_customer_id
      and c.workspace_id = p_workspace_id
      and c.status = 'active';
    if v_customer_name is null then
      raise exception using errcode = '22023', message = 'Choose an active customer from this workspace';
    end if;
    v_action_type := 'map_customer';
    v_configuration := '{"matchMode":"contains_normalized"}'::jsonb;
    v_name := 'Description customer mapping';
  elsif p_rule_type = 'reference_pattern' then
    if not app_private.custom_reference_template_is_valid(p_source_pattern)
       or p_customer_id is not null
       or p_maximum_fee_minor is not null
       or p_maximum_fee_basis_points is not null then
      raise exception using errcode = '22023', message = 'Use one {digits} or {alnum} token with at least two literal characters';
    end if;
    v_action_type := 'extract_reference';
    v_configuration := '{"templateVersion":1}'::jsonb;
    v_name := 'Reference extraction template';
  else
    if char_length(v_normalized_pattern) not between 4 and 120
       or p_customer_id is not null
       or p_maximum_fee_minor is null
       or p_maximum_fee_minor not between 1 and 25000
       or p_maximum_fee_basis_points is null
       or p_maximum_fee_basis_points not between 1 and 500 then
      raise exception using errcode = '22023', message = 'Enter a fee descriptor, a review cap up to 25000 minor units, and a rate up to 5 percent';
    end if;
    v_action_type := 'flag_possible_fee';
    v_configuration := pg_catalog.jsonb_build_object(
      'maximumFeeMinor', p_maximum_fee_minor,
      'maximumFeeBasisPoints', p_maximum_fee_basis_points
    );
    v_name := 'Accepted fee review behavior';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':custom-rule:' || p_rule_type || ':' || v_normalized_pattern, 0)
  );
  select r.id into v_conflict_id
  from public.matching_rules r
  where r.workspace_id = p_workspace_id
    and r.rule_type = p_rule_type
    and r.normalized_pattern = v_normalized_pattern
    and r.is_active
    and r.id <> p_rule_id
  limit 1;
  if v_conflict_id is not null then
    raise exception using errcode = '23505', message = 'This source pattern already has an active custom rule';
  end if;
  if v_previous.rule_type = p_rule_type
     and v_previous.source_pattern = btrim(p_source_pattern)
     and v_previous.normalized_pattern = v_normalized_pattern
     and v_previous.customer_id is not distinct from p_customer_id
     and v_previous.configuration = v_configuration then
    return pg_catalog.jsonb_build_object('existing', true, 'rule', pg_catalog.jsonb_build_object(
      'id', v_previous.id, 'kind', case v_previous.rule_type when 'description_pattern' then 'description_customer' when 'reference_pattern' then 'reference_template' else 'accepted_fee_behavior' end,
      'sourcePattern', v_previous.source_pattern, 'normalizedPattern', v_previous.normalized_pattern,
      'customerId', v_previous.customer_id, 'customerName', v_customer_name,
      'customerExternalId', v_customer_external_id,
      'maximumFeeMinor', v_previous.configuration -> 'maximumFeeMinor',
      'maximumFeeBasisPoints', v_previous.configuration -> 'maximumFeeBasisPoints',
      'createdAt', v_previous.created_at, 'updatedAt', v_previous.updated_at
    ));
  end if;

  update public.matching_rules
  set
    name = v_name,
    rule_type = p_rule_type,
    source_pattern = btrim(p_source_pattern),
    normalized_pattern = v_normalized_pattern,
    customer_id = p_customer_id,
    action_type = v_action_type,
    configuration = v_configuration,
    is_active = true
  where id = v_previous.id
  returning * into v_rule;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type,
    event_type, entity_type, entity_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'user',
    'matching_rule.updated', 'matching_rule', v_rule.id,
    pg_catalog.jsonb_build_object(
      'previous_state', pg_catalog.jsonb_build_object(
        'rule_type', v_previous.rule_type, 'source_pattern', v_previous.source_pattern,
        'normalized_pattern', v_previous.normalized_pattern, 'customer_id', v_previous.customer_id,
        'configuration', v_previous.configuration, 'is_active', true
      ),
      'current_state', pg_catalog.jsonb_build_object(
        'rule_type', v_rule.rule_type, 'source_pattern', v_rule.source_pattern,
        'normalized_pattern', v_rule.normalized_pattern, 'customer_id', v_rule.customer_id,
        'configuration', v_rule.configuration, 'is_active', true
      ),
      'influence', case when v_rule.rule_type = 'fee_behavior' then 'review_evidence_only' else 'bounded_identity_evidence' end
    )
  );

  return pg_catalog.jsonb_build_object('existing', false, 'rule', pg_catalog.jsonb_build_object(
    'id', v_rule.id, 'kind', case v_rule.rule_type when 'description_pattern' then 'description_customer' when 'reference_pattern' then 'reference_template' else 'accepted_fee_behavior' end,
    'sourcePattern', v_rule.source_pattern, 'normalizedPattern', v_rule.normalized_pattern,
    'customerId', v_rule.customer_id, 'customerName', v_customer_name,
    'customerExternalId', v_customer_external_id,
    'maximumFeeMinor', v_rule.configuration -> 'maximumFeeMinor',
    'maximumFeeBasisPoints', v_rule.configuration -> 'maximumFeeBasisPoints',
    'createdAt', v_rule.created_at, 'updatedAt', v_rule.updated_at
  ));
end;
$$;

create or replace function public.delete_workspace_custom_matching_rule(
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
  v_rule public.matching_rules%rowtype;
begin
  -- Deletion intentionally remains available after plan downgrade or
  -- organization suspension so authorized editors can remove stored behavior.
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select r, w.organization_id into v_rule, v_organization_id
  from public.matching_rules r
  join public.workspaces w on w.id = r.workspace_id
  where r.id = p_rule_id
    and r.workspace_id = p_workspace_id
    and w.status = 'active'
  for update of r;
  if not found or not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace editing access is required';
  end if;
  if not v_rule.is_active then
    return pg_catalog.jsonb_build_object('ruleId', v_rule.id, 'deleted', true, 'existing', true);
  end if;
  update public.matching_rules set is_active = false where id = v_rule.id;
  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, actor_type,
    event_type, entity_type, entity_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'user',
    'matching_rule.deleted', 'matching_rule', v_rule.id,
    pg_catalog.jsonb_build_object(
      'previous_state', pg_catalog.jsonb_build_object(
        'rule_type', v_rule.rule_type, 'source_pattern', v_rule.source_pattern,
        'normalized_pattern', v_rule.normalized_pattern, 'customer_id', v_rule.customer_id,
        'configuration', v_rule.configuration, 'is_active', true
      ),
      'current_state', pg_catalog.jsonb_build_object('is_active', false),
      'influence', 'removed_from_future_runs'
    )
  );
  return pg_catalog.jsonb_build_object('ruleId', v_rule.id, 'deleted', true, 'existing', false);
end;
$$;

revoke all on function public.create_workspace_custom_matching_rule(uuid, text, text, uuid, integer, integer)
from public, anon;
revoke all on function public.update_workspace_custom_matching_rule(uuid, uuid, text, text, uuid, integer, integer)
from public, anon;
revoke all on function public.delete_workspace_custom_matching_rule(uuid, uuid)
from public, anon;
grant execute on function public.create_workspace_custom_matching_rule(uuid, text, text, uuid, integer, integer)
to authenticated;
grant execute on function public.update_workspace_custom_matching_rule(uuid, uuid, text, text, uuid, integer, integer)
to authenticated;
grant execute on function public.delete_workspace_custom_matching_rule(uuid, uuid)
to authenticated;

comment on table public.matching_rules is
  'Inspectable Business and Bookkeeper custom matching rules. Authenticated clients read through RLS and mutate only through audited, plan-aware functions. Reference rules are bounded templates, never user regex.';

commit;
