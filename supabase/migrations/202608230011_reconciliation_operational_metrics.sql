begin;

alter table public.usage_records drop constraint if exists usage_records_metric_check;
alter table public.usage_records add constraint usage_records_metric_check check (
  metric_code in (
    'payments_processed', 'imports_completed', 'workspaces_active',
    'matches_confirmed', 'exports_created', 'auto_matched',
    'sent_to_review', 'matches_rejected'
  )
);

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

  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values
    (new.organization_id, new.workspace_id, 'auto_matched', current_date, current_date,
      coalesce(v_auto_matched, 0), 'reconciliation-run:' || new.entity_id::text || ':auto-matched'),
    (new.organization_id, new.workspace_id, 'sent_to_review', current_date, current_date,
      coalesce(v_sent_to_review, 0), 'reconciliation-run:' || new.entity_id::text || ':sent-to-review')
  on conflict (organization_id, source_event_id) where source_event_id is not null do nothing;

  insert into public.analytics_events (
    event_name, user_id, organization_id, workspace_id, path, properties
  ) values (
    'reconciliation_completed', new.actor_user_id, new.organization_id, new.workspace_id,
    '/app', jsonb_build_object('source', 'in_app')
  );
  return new;
end;
$$;

drop trigger if exists audit_events_record_completed_run_metrics on public.audit_events;
create trigger audit_events_record_completed_run_metrics
after insert on public.audit_events
for each row when (new.event_type = 'reconciliation_run.completed')
execute function app_private.record_completed_run_metrics();

create or replace function app_private.record_reconciliation_action_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if new.action_type <> 'reject' then
    return new;
  end if;
  select w.organization_id into v_organization_id
  from public.workspaces w where w.id = new.workspace_id;

  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values (
    v_organization_id, new.workspace_id, 'matches_rejected', current_date, current_date,
    1, 'reconciliation-action:' || new.id::text || ':rejected'
  ) on conflict (organization_id, source_event_id) where source_event_id is not null do nothing;

  insert into public.analytics_events (
    event_name, user_id, organization_id, workspace_id, path, properties
  ) values (
    'match_rejected', new.actor_user_id, v_organization_id, new.workspace_id,
    '/app', jsonb_build_object('source', 'in_app')
  );
  return new;
end;
$$;

drop trigger if exists reconciliation_actions_record_metric on public.reconciliation_actions;
create trigger reconciliation_actions_record_metric
after insert on public.reconciliation_actions
for each row execute function app_private.record_reconciliation_action_metric();

commit;
