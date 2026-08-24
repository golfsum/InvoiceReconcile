begin;

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid,
  provider text not null,
  status text not null default 'disconnected',
  external_tenant_id text,
  secret_reference text,
  configuration jsonb not null default '{}'::jsonb,
  scopes text[] not null default '{}'::text[],
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint integrations_provider_check check (provider in ('quickbooks', 'xero', 'plaid', 'stripe', 'square', 'postmark')),
  constraint integrations_status_check check (status in ('disconnected', 'pending', 'connected', 'degraded', 'revoked', 'error')),
  constraint integrations_config_object check (jsonb_typeof(configuration) = 'object'),
  constraint integrations_no_embedded_secret check (
    configuration::text !~* '"(access_token|refresh_token|client_secret|api_key|password)"\s*:'
  )
);

create unique index integrations_scope_provider_uidx on public.integrations (
  organization_id,
  coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
  provider
);
create index integrations_status_idx on public.integrations (organization_id, status, provider);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  provider_price_id text,
  plan_code text not null default 'free',
  status text not null default 'active',
  unit_amount_minor bigint not null default 0,
  quantity integer not null default 1,
  currency_code text not null default 'USD',
  billing_interval text not null default 'month',
  monthly_recurring_revenue_minor bigint generated always as (
    case
      when status in ('active', 'trialing', 'past_due') and billing_interval = 'month'
        then unit_amount_minor * quantity
      when status in ('active', 'trialing', 'past_due') and billing_interval = 'year'
        then (unit_amount_minor * quantity) / 12
      else 0
    end
  ) stored,
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_provider_check check (provider = 'stripe'),
  constraint subscriptions_plan_check check (plan_code in ('free', 'solo', 'business', 'bookkeeper')),
  constraint subscriptions_status_check check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  constraint subscriptions_amount_check check (unit_amount_minor >= 0 and quantity > 0),
  constraint subscriptions_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint subscriptions_interval_check check (billing_interval in ('month', 'year'))
);

create unique index subscriptions_customer_uidx on public.subscriptions (provider_customer_id) where provider_customer_id is not null;
create unique index subscriptions_provider_subscription_uidx on public.subscriptions (provider_subscription_id) where provider_subscription_id is not null;
create index subscriptions_admin_status_idx on public.subscriptions (status, plan_code, created_at desc);

create table public.usage_records (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid,
  metric_code text not null,
  period_start date not null,
  period_end date not null,
  quantity bigint not null default 0,
  source_event_id text,
  recorded_at timestamptz not null default now(),
  constraint usage_records_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint usage_records_metric_check check (metric_code in ('payments_processed', 'imports_completed', 'workspaces_active', 'matches_confirmed', 'exports_created')),
  constraint usage_records_period_check check (period_end >= period_start),
  constraint usage_records_quantity_check check (quantity >= 0)
);

create unique index usage_records_source_uidx on public.usage_records (organization_id, source_event_id) where source_event_id is not null;
create index usage_records_billing_idx on public.usage_records (organization_id, metric_code, period_start, period_end);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid(),
  event_name text not null,
  occurred_at timestamptz not null default now(),
  anonymous_id uuid,
  session_id uuid,
  user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  workspace_id uuid,
  path text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  properties jsonb not null default '{}'::jsonb,
  constraint analytics_events_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete set null (workspace_id),
  constraint analytics_events_id_unique unique (event_id),
  constraint analytics_events_name_check check (event_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint analytics_events_identity_check check (anonymous_id is not null or user_id is not null),
  constraint analytics_events_properties_object check (jsonb_typeof(properties) = 'object'),
  constraint analytics_events_no_financial_or_pii check (
    properties::text !~* '"(amount|invoice|customer|payer|memo|reference|description|email|filename|raw)[^"]*"\s*:'
  )
);

create index analytics_events_occurred_idx on public.analytics_events (occurred_at desc);
create index analytics_events_name_occurred_idx on public.analytics_events (event_name, occurred_at desc);
create index analytics_events_user_history_idx on public.analytics_events (user_id, occurred_at desc) where user_id is not null;
create index analytics_events_org_idx on public.analytics_events (organization_id, occurred_at desc) where organization_id is not null;
create index analytics_events_anonymous_idx on public.analytics_events (anonymous_id, occurred_at desc) where anonymous_id is not null;

create table public.analytics_daily_aggregates (
  id bigint generated always as identity primary key,
  aggregate_date date not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  metric_code text not null,
  dimension_key text not null default 'all',
  dimensions jsonb not null default '{}'::jsonb,
  metric_value numeric(20,4) not null,
  unique_users bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_daily_metric_check check (metric_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint analytics_daily_dimensions_object check (jsonb_typeof(dimensions) = 'object'),
  constraint analytics_daily_values_check check (unique_users is null or unique_users >= 0),
  unique nulls not distinct (aggregate_date, organization_id, metric_code, dimension_key)
);

create index analytics_daily_admin_idx on public.analytics_daily_aggregates (aggregate_date desc, metric_code);
create index analytics_daily_org_idx on public.analytics_daily_aggregates (organization_id, aggregate_date desc) where organization_id is not null;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  workspace_id uuid,
  feedback_type text not null default 'general',
  rating smallint,
  message text not null,
  contact_email text,
  page_path text,
  status text not null default 'new',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete set null (workspace_id),
  constraint feedback_type_check check (feedback_type in ('general', 'bug', 'import_problem', 'matching_quality', 'feature_request', 'cancellation')),
  constraint feedback_rating_check check (rating is null or rating between 1 and 5),
  constraint feedback_message_check check (char_length(btrim(message)) between 1 and 10000),
  constraint feedback_status_check check (status in ('new', 'reviewing', 'resolved', 'closed'))
);

create index feedback_admin_queue_idx on public.feedback (status, created_at desc);
create index feedback_user_idx on public.feedback (user_id, created_at desc) where user_id is not null;

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid,
  import_id uuid,
  job_type text not null,
  status text not null default 'queued',
  idempotency_key text not null,
  queue_name text not null default 'default',
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  payload_reference text,
  progress_current integer not null default 0,
  progress_total integer,
  error_code text,
  error_summary text,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint background_jobs_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint background_jobs_import_workspace_fk foreign key (import_id, workspace_id)
    references public.imports(id, workspace_id) on delete cascade,
  constraint background_jobs_scope_check check (workspace_id is null or organization_id is not null),
  constraint background_jobs_type_check check (job_type in ('process_import', 'run_matching', 'generate_export', 'sync_integration', 'aggregate_analytics', 'retention_cleanup')),
  constraint background_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead_letter')),
  constraint background_jobs_attempt_check check (attempts between 0 and max_attempts and max_attempts between 1 and 20),
  constraint background_jobs_progress_check check (progress_current >= 0 and (progress_total is null or progress_total >= progress_current)),
  unique nulls not distinct (organization_id, idempotency_key)
);

create index background_jobs_worker_idx on public.background_jobs (queue_name, scheduled_at) where status = 'queued';
create index background_jobs_admin_failures_idx on public.background_jobs (status, created_at desc) where status in ('failed', 'dead_letter');
create index background_jobs_workspace_idx on public.background_jobs (workspace_id, created_at desc) where workspace_id is not null;

create table public.application_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid,
  user_id uuid references public.profiles(id) on delete set null,
  job_id uuid references public.background_jobs(id) on delete set null,
  request_id text,
  error_code text not null,
  severity text not null default 'error',
  component text not null,
  safe_message text not null,
  fingerprint text,
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint application_errors_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint application_errors_scope_check check (workspace_id is null or organization_id is not null),
  constraint application_errors_severity_check check (severity in ('warning', 'error', 'critical')),
  constraint application_errors_message_check check (btrim(safe_message) <> '' and char_length(safe_message) <= 2000),
  constraint application_errors_context_object check (jsonb_typeof(context) = 'object'),
  constraint application_errors_no_secret_fields check (
    context::text !~* '"(access_token|refresh_token|client_secret|api_key|password|authorization|cookie)"\s*:'
  )
);

create index application_errors_admin_idx on public.application_errors (created_at desc, severity);
create index application_errors_fingerprint_idx on public.application_errors (fingerprint, created_at desc) where fingerprint is not null;
create index application_errors_org_idx on public.application_errors (organization_id, created_at desc) where organization_id is not null;

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text,
  message text not null,
  source_path text,
  status text not null default 'new',
  assigned_to uuid references public.profiles(id) on delete set null,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_requests_name_check check (char_length(btrim(name)) between 1 and 200),
  constraint contact_requests_email_check check (char_length(btrim(email)) between 3 and 320 and position('@' in email) > 1),
  constraint contact_requests_message_check check (char_length(btrim(message)) between 1 and 10000),
  constraint contact_requests_status_check check (status in ('new', 'reviewing', 'resolved', 'spam'))
);

create index contact_requests_admin_queue_idx on public.contact_requests (status, created_at desc);

create or replace function app_private.analytics_scope_is_valid(
  target_user_id uuid,
  target_organization_id uuid,
  target_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id = auth.uid()
    and (
      (target_organization_id is null and target_workspace_id is null)
      or (
        target_organization_id is not null
        and app_private.is_org_member(target_organization_id)
        and (
          target_workspace_id is null
          or exists (
            select 1 from public.workspaces w
            where w.id = target_workspace_id
              and w.organization_id = target_organization_id
          )
        )
      )
    )
$$;

revoke all on function app_private.analytics_scope_is_valid(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.analytics_scope_is_valid(uuid, uuid, uuid) to authenticated;

alter table public.integrations enable row level security;
create policy integrations_select_org_member on public.integrations
for select to authenticated using (app_private.is_org_member(organization_id));
create policy integrations_insert_org_admin on public.integrations
for insert to authenticated with check (app_private.has_org_role(organization_id, array['owner', 'admin']));
create policy integrations_update_org_admin on public.integrations
for update to authenticated using (app_private.has_org_role(organization_id, array['owner', 'admin']))
with check (app_private.has_org_role(organization_id, array['owner', 'admin']));
create policy integrations_delete_org_admin on public.integrations
for delete to authenticated using (app_private.has_org_role(organization_id, array['owner', 'admin']));

alter table public.subscriptions enable row level security;
create policy subscriptions_select_org_or_internal_admin on public.subscriptions
for select to authenticated using (app_private.is_org_member(organization_id) or app_private.is_internal_admin());

alter table public.usage_records enable row level security;
create policy usage_records_select_org_or_internal_admin on public.usage_records
for select to authenticated using (app_private.is_org_member(organization_id) or app_private.is_internal_admin());

alter table public.analytics_events enable row level security;
create policy analytics_events_insert_anonymous on public.analytics_events
for insert to anon with check (user_id is null and organization_id is null and workspace_id is null and anonymous_id is not null);
create policy analytics_events_insert_authenticated on public.analytics_events
for insert to authenticated with check (app_private.analytics_scope_is_valid(user_id, organization_id, workspace_id));
create policy analytics_events_select_internal_admin on public.analytics_events
for select to authenticated using (app_private.is_internal_admin());

alter table public.analytics_daily_aggregates enable row level security;
create policy analytics_daily_select_org_or_internal_admin on public.analytics_daily_aggregates
for select to authenticated using (
  app_private.is_internal_admin()
  or (organization_id is not null and app_private.is_org_member(organization_id))
);

alter table public.feedback enable row level security;
create policy feedback_select_owner_or_internal_admin on public.feedback
for select to authenticated using (user_id = auth.uid() or app_private.is_internal_admin());
create policy feedback_insert_authenticated on public.feedback
for insert to authenticated with check (
  user_id = auth.uid()
  and (
    organization_id is null
    or (
      app_private.is_org_member(organization_id)
      and (workspace_id is null or app_private.can_access_workspace(workspace_id))
    )
  )
  and status = 'new'
  and admin_notes is null
);
create policy feedback_update_internal_admin on public.feedback
for update to authenticated using (app_private.is_internal_admin()) with check (app_private.is_internal_admin());

alter table public.background_jobs enable row level security;
create policy background_jobs_select_scope_or_internal_admin on public.background_jobs
for select to authenticated using (
  app_private.is_internal_admin()
  or (organization_id is not null and app_private.is_org_member(organization_id))
);

alter table public.application_errors enable row level security;
create policy application_errors_select_scope_or_internal_admin on public.application_errors
for select to authenticated using (
  app_private.is_internal_admin()
  or user_id = auth.uid()
  or (organization_id is not null and app_private.is_org_member(organization_id))
);
create policy application_errors_insert_authenticated on public.application_errors
for insert to authenticated with check (
  user_id = auth.uid()
  and (organization_id is null or app_private.is_org_member(organization_id))
  and (workspace_id is null or app_private.can_access_workspace(workspace_id))
  and resolved_at is null
  and resolved_by is null
);
create policy application_errors_update_internal_admin on public.application_errors
for update to authenticated using (app_private.is_internal_admin()) with check (app_private.is_internal_admin());

alter table public.contact_requests enable row level security;
create policy contact_requests_insert_public on public.contact_requests
for insert to anon, authenticated with check (status = 'new' and assigned_to is null and admin_notes is null);
create policy contact_requests_select_internal_admin on public.contact_requests
for select to authenticated using (app_private.is_internal_admin());
create policy contact_requests_update_internal_admin on public.contact_requests
for update to authenticated using (app_private.is_internal_admin()) with check (app_private.is_internal_admin());

create trigger integrations_touch_updated_at before update on public.integrations
for each row execute function app_private.touch_updated_at();
create trigger integrations_validate_connector before insert or update on public.integrations
for each row execute function app_private.validate_authenticated_actor('connected_by');
create trigger integrations_prevent_org_reassignment before update on public.integrations
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger integrations_prevent_workspace_reassignment before update on public.integrations
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger subscriptions_touch_updated_at before update on public.subscriptions
for each row execute function app_private.touch_updated_at();
create trigger subscriptions_prevent_org_reassignment before update on public.subscriptions
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger analytics_daily_touch_updated_at before update on public.analytics_daily_aggregates
for each row execute function app_private.touch_updated_at();
create trigger analytics_daily_prevent_org_reassignment before update on public.analytics_daily_aggregates
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger feedback_touch_updated_at before update on public.feedback
for each row execute function app_private.touch_updated_at();
create trigger feedback_prevent_user_reassignment before update on public.feedback
for each row execute function app_private.prevent_tenant_reassignment('user_id');
create trigger feedback_prevent_org_reassignment before update on public.feedback
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger feedback_prevent_workspace_reassignment before update on public.feedback
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger background_jobs_touch_updated_at before update on public.background_jobs
for each row execute function app_private.touch_updated_at();
create trigger contact_requests_touch_updated_at before update on public.contact_requests
for each row execute function app_private.touch_updated_at();

revoke all on public.integrations, public.subscriptions, public.usage_records, public.analytics_events,
  public.analytics_daily_aggregates, public.feedback, public.background_jobs, public.application_errors,
  public.contact_requests from anon, authenticated;

grant select, insert, update, delete on public.integrations to authenticated;
grant select on public.subscriptions, public.usage_records, public.analytics_daily_aggregates, public.background_jobs to authenticated;
grant select on public.analytics_events to authenticated;
grant insert (
  event_id, event_name, anonymous_id, session_id, user_id, organization_id,
  workspace_id, path, referrer_host, utm_source, utm_medium, utm_campaign, properties
) on public.analytics_events to authenticated;
grant insert (
  event_id, event_name, anonymous_id, session_id, path, referrer_host,
  utm_source, utm_medium, utm_campaign, properties
) on public.analytics_events to anon;
grant select, update on public.feedback, public.application_errors to authenticated;
grant insert (
  user_id, organization_id, workspace_id, feedback_type, rating, message,
  contact_email, page_path
) on public.feedback to authenticated;
grant insert (
  organization_id, workspace_id, user_id, request_id, error_code, severity,
  component, safe_message, fingerprint, context
) on public.application_errors to authenticated;
grant insert (name, email, subject, message, source_path) on public.contact_requests to anon, authenticated;
grant select, update on public.contact_requests to authenticated;
grant usage on sequence public.analytics_events_id_seq to anon, authenticated;

commit;
