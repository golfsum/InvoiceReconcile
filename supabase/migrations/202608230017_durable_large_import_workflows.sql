begin;

alter table public.profiles
add column transactional_import_emails boolean not null default true;
grant update (transactional_import_emails) on public.profiles to authenticated;

create table public.import_source_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  import_kind text not null,
  source_type text not null,
  expected_content_type text not null,
  expected_byte_size bigint not null,
  expected_sha256 text not null,
  storage_bucket text not null default 'import-source-files',
  storage_path text not null,
  upload_nonce uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  status text not null default 'awaiting_upload',
  upload_expires_at timestamptz not null,
  upload_capability_safe_delete_at timestamptz,
  finalized_at timestamptz,
  requested_sheet text,
  selected_sheet text,
  sheet_names jsonb not null default '[]'::jsonb,
  source_headers jsonb not null default '[]'::jsonb,
  row_count integer,
  suggested_mapping jsonb not null default '{}'::jsonb,
  mapping_source text,
  issue_summary jsonb not null default '[]'::jsonb,
  preview_generation integer not null default 0,
  progress_current integer not null default 0,
  progress_total integer not null default 100,
  progress_label text not null default 'Waiting for upload',
  workflow_run_id text,
  worker_step_id text,
  worker_claim_hash text,
  worker_claim_expires_at timestamptz,
  error_code text,
  error_message text,
  email_delivery_status text not null default 'pending',
  email_delivery_code text,
  retention_at timestamptz not null default (now() + interval '24 hours'),
  object_deletion_status text not null default 'retained',
  object_deletion_requested_at timestamptz,
  object_deleted_at timestamptz,
  object_deletion_attempts integer not null default 0,
  object_deletion_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_source_uploads_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint import_source_uploads_kind_check check (import_kind in ('invoice', 'payment')),
  constraint import_source_uploads_type_check check (source_type in ('csv', 'xlsx')),
  constraint import_source_uploads_content_type_check check (
    (source_type = 'csv' and expected_content_type = 'text/csv')
    or (source_type = 'xlsx' and expected_content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ),
  constraint import_source_uploads_size_check check (expected_byte_size between 1 and 52428800),
  constraint import_source_uploads_sha_check check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  constraint import_source_uploads_bucket_check check (storage_bucket = 'import-source-files'),
  constraint import_source_uploads_path_check check (storage_path <> '' and char_length(storage_path) <= 500),
  constraint import_source_uploads_status_check check (status in (
    'awaiting_upload', 'preview_queued', 'preview_processing', 'preview_ready',
    'reconciling', 'completed', 'failed', 'cancelled', 'expired'
  )),
  constraint import_source_uploads_json_check check (
    jsonb_typeof(sheet_names) = 'array'
    and jsonb_typeof(source_headers) = 'array'
    and jsonb_typeof(suggested_mapping) = 'object'
    and jsonb_typeof(issue_summary) = 'array'
  ),
  constraint import_source_uploads_mapping_source_check check (mapping_source is null or mapping_source in ('saved', 'detected')),
  constraint import_source_uploads_row_count_check check (row_count is null or row_count between 0 and 50000),
  constraint import_source_uploads_progress_check check (
    progress_total = 100 and progress_current between 0 and progress_total
  ),
  constraint import_source_uploads_worker_pair_check check (
    (worker_step_id is null) = (worker_claim_hash is null)
    and (worker_claim_hash is null) = (worker_claim_expires_at is null)
  ),
  constraint import_source_uploads_error_pair_check check ((error_code is null) = (error_message is null)),
  constraint import_source_uploads_email_check check (
    email_delivery_status in ('pending', 'sent', 'failed', 'skipped')
    and (email_delivery_code is null or char_length(email_delivery_code) <= 100)
  ),
  constraint import_source_uploads_deletion_check check (
    object_deletion_status in ('retained', 'pending', 'deleted')
    and object_deletion_attempts between 0 and 32767
    and (object_deletion_error_code is null or char_length(object_deletion_error_code) <= 100)
    and (object_deletion_status <> 'retained' or object_deletion_requested_at is null)
    and (object_deletion_status <> 'deleted' or object_deleted_at is not null)
  ),
  unique (id, workspace_id),
  unique (storage_bucket, storage_path),
  unique (created_by, workspace_id, idempotency_key)
);

create index import_source_uploads_workspace_idx
on public.import_source_uploads (workspace_id, created_at desc);
create index import_source_uploads_retention_idx
on public.import_source_uploads (retention_at)
where object_deletion_status <> 'deleted';
create index import_source_uploads_deletion_pending_idx
on public.import_source_uploads (object_deletion_requested_at)
where object_deletion_status = 'pending';

create table public.async_reconciliation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  invoice_source_id uuid not null,
  payment_source_id uuid not null,
  invoice_mapping jsonb not null,
  payment_mapping jsonb not null,
  idempotency_key uuid not null,
  status text not null default 'queued',
  progress_current integer not null default 0,
  progress_total integer not null default 100,
  progress_label text not null default 'Queued',
  workflow_run_id text,
  worker_step_id text,
  worker_claim_hash text,
  worker_claim_expires_at timestamptz,
  run_record_id uuid references public.reconciliation_runs(id) on delete set null,
  run_key text,
  result_summary jsonb,
  error_code text,
  error_message text,
  email_delivery_status text not null default 'pending',
  email_delivery_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint async_reconciliation_requests_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint async_reconciliation_invoice_source_fk foreign key (invoice_source_id, workspace_id)
    references public.import_source_uploads(id, workspace_id) on delete restrict,
  constraint async_reconciliation_payment_source_fk foreign key (payment_source_id, workspace_id)
    references public.import_source_uploads(id, workspace_id) on delete restrict,
  constraint async_reconciliation_requests_sources_check check (invoice_source_id <> payment_source_id),
  constraint async_reconciliation_requests_mapping_check check (
    jsonb_typeof(invoice_mapping) = 'object' and jsonb_typeof(payment_mapping) = 'object'
  ),
  constraint async_reconciliation_requests_status_check check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  constraint async_reconciliation_requests_progress_check check (
    progress_total = 100 and progress_current between 0 and progress_total
  ),
  constraint async_reconciliation_requests_worker_pair_check check (
    (worker_step_id is null) = (worker_claim_hash is null)
    and (worker_claim_hash is null) = (worker_claim_expires_at is null)
  ),
  constraint async_reconciliation_requests_summary_check check (result_summary is null or jsonb_typeof(result_summary) = 'object'),
  constraint async_reconciliation_requests_error_pair_check check ((error_code is null) = (error_message is null)),
  constraint async_reconciliation_requests_email_check check (
    email_delivery_status in ('pending', 'sent', 'failed', 'skipped')
    and (email_delivery_code is null or char_length(email_delivery_code) <= 100)
  ),
  unique (id, workspace_id),
  unique (submitted_by, workspace_id, idempotency_key)
);

create unique index async_reconciliation_active_sources_uidx
on public.async_reconciliation_requests (invoice_source_id, payment_source_id)
where status in ('queued', 'processing', 'succeeded');
create index async_reconciliation_workspace_idx
on public.async_reconciliation_requests (workspace_id, created_at desc);

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null,
  event_type text not null,
  entity_id uuid not null,
  title text not null,
  body text not null,
  action_path text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_notifications_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint user_notifications_event_check check (event_type in (
    'import_preview_ready', 'import_failed', 'reconciliation_ready', 'reconciliation_failed'
  )),
  constraint user_notifications_copy_check check (
    btrim(title) <> '' and char_length(title) <= 120
    and btrim(body) <> '' and char_length(body) <= 500
    and action_path ~ '^/app/[0-9a-f-]+/(imports|exceptions)$'
  ),
  unique (user_id, event_type, entity_id)
);

create index user_notifications_unread_idx
on public.user_notifications (user_id, created_at desc)
where read_at is null;

create table public.reconciliation_run_read_items (
  reconciliation_run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null,
  item_type text not null,
  ordinal integer not null,
  item_id text not null,
  item jsonb not null,
  search_text text not null default '',
  status_code text,
  created_at timestamptz not null default now(),
  primary key (reconciliation_run_id, item_type, item_id),
  unique (reconciliation_run_id, item_type, ordinal),
  constraint reconciliation_run_read_items_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint reconciliation_run_read_items_type_check check (item_type in ('invoice', 'payment', 'match')),
  constraint reconciliation_run_read_items_ordinal_check check (ordinal between 1 and 100000),
  constraint reconciliation_run_read_items_id_check check (btrim(item_id) <> '' and char_length(item_id) <= 300),
  constraint reconciliation_run_read_items_json_check check (jsonb_typeof(item) = 'object' and pg_column_size(item) <= 262144),
  constraint reconciliation_run_read_items_search_check check (char_length(search_text) <= 2000),
  constraint reconciliation_run_read_items_status_check check (status_code is null or char_length(status_code) <= 100)
);

create index reconciliation_run_read_items_page_idx
on public.reconciliation_run_read_items (reconciliation_run_id, item_type, ordinal);
create index reconciliation_run_read_items_filter_idx
on public.reconciliation_run_read_items (reconciliation_run_id, item_type, status_code, ordinal);

create or replace function app_private.prevent_tenant_delete_with_private_import_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_sources boolean;
begin
  if tg_table_name = 'workspaces' then
    select exists (
      select 1 from public.import_source_uploads source
      where source.workspace_id = old.id and source.object_deletion_status <> 'deleted'
    ) into v_has_sources;
  elsif tg_table_name = 'organizations' then
    select exists (
      select 1 from public.import_source_uploads source
      where source.organization_id = old.id and source.object_deletion_status <> 'deleted'
    ) into v_has_sources;
  else
    raise exception using errcode = '55000', message = 'The private-source deletion fence was used on an unsupported table';
  end if;
  if v_has_sources then
    raise exception using errcode = '55000', message = 'Private import source deletion must be confirmed before deleting this workspace or organization';
  end if;
  return old;
end;
$$;
revoke all on function app_private.prevent_tenant_delete_with_private_import_sources() from public;

create trigger workspaces_require_private_import_source_cleanup
before delete on public.workspaces
for each row execute function app_private.prevent_tenant_delete_with_private_import_sources();
create trigger organizations_require_private_import_source_cleanup
before delete on public.organizations
for each row execute function app_private.prevent_tenant_delete_with_private_import_sources();

alter table public.import_source_uploads enable row level security;
create policy import_source_uploads_select_creator
on public.import_source_uploads for select to authenticated
using (created_by = auth.uid() and app_private.can_access_workspace(workspace_id));

alter table public.async_reconciliation_requests enable row level security;
create policy async_reconciliation_requests_select_submitter
on public.async_reconciliation_requests for select to authenticated
using (submitted_by = auth.uid() and app_private.can_access_workspace(workspace_id));

alter table public.user_notifications enable row level security;
create policy user_notifications_select_owner
on public.user_notifications for select to authenticated
using (user_id = auth.uid() and app_private.can_access_workspace(workspace_id));
create policy user_notifications_mark_read
on public.user_notifications for update to authenticated
using (user_id = auth.uid() and app_private.can_access_workspace(workspace_id))
with check (user_id = auth.uid() and app_private.can_access_workspace(workspace_id));

alter table public.reconciliation_run_read_items enable row level security;

create trigger import_source_uploads_touch_updated_at before update on public.import_source_uploads
for each row execute function app_private.touch_updated_at();
create trigger import_source_uploads_prevent_org_reassignment before update on public.import_source_uploads
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger import_source_uploads_prevent_workspace_reassignment before update on public.import_source_uploads
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger import_source_uploads_prevent_creator_reassignment before update on public.import_source_uploads
for each row execute function app_private.prevent_tenant_reassignment('created_by');

create trigger async_reconciliation_requests_touch_updated_at before update on public.async_reconciliation_requests
for each row execute function app_private.touch_updated_at();
create trigger async_reconciliation_requests_prevent_org_reassignment before update on public.async_reconciliation_requests
for each row execute function app_private.prevent_tenant_reassignment('organization_id');
create trigger async_reconciliation_requests_prevent_workspace_reassignment before update on public.async_reconciliation_requests
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger async_reconciliation_requests_prevent_submitter_reassignment before update on public.async_reconciliation_requests
for each row execute function app_private.prevent_tenant_reassignment('submitted_by');

create or replace function app_private.require_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role access is required';
  end if;
end;
$$;

create or replace function app_private.worker_token_hash(worker_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(worker_token, ''), 'sha256'), 'hex')
$$;

revoke all on function app_private.require_service_role() from public, anon, authenticated;
revoke all on function app_private.worker_token_hash(text) from public, anon, authenticated;

create or replace function public.initialize_async_import_source(
  p_workspace_id uuid,
  p_import_kind text,
  p_source_type text,
  p_expected_byte_size bigint,
  p_expected_sha256 text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_source_id uuid := gen_random_uuid();
  v_nonce uuid := gen_random_uuid();
  v_content_type text;
  v_path text;
  v_existing public.import_source_uploads%rowtype;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_import_kind not in ('invoice', 'payment')
     or p_source_type not in ('csv', 'xlsx')
     or p_expected_byte_size not between 1 and 52428800
     or p_expected_sha256 !~ '^[0-9a-f]{64}$'
     or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'The upload intent is invalid';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  join public.organizations o on o.id = w.organization_id and o.status = 'active'
  join public.memberships m on m.organization_id = w.organization_id
    and m.user_id = v_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')
  where w.id = p_workspace_id and w.status = 'active';
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;

  delete from public.import_source_uploads s
  where s.created_by = v_actor
    and s.workspace_id = p_workspace_id
    and s.status in ('awaiting_upload', 'expired')
    and s.upload_expires_at <= statement_timestamp()
    and s.upload_capability_safe_delete_at is null
    and s.object_deletion_status = 'deleted'
    and s.object_deleted_at is not null;

  select * into v_existing
  from public.import_source_uploads s
  where s.created_by = v_actor
    and s.workspace_id = p_workspace_id
    and s.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.import_kind <> p_import_kind
       or v_existing.source_type <> p_source_type
       or v_existing.expected_byte_size <> p_expected_byte_size
       or v_existing.expected_sha256 <> p_expected_sha256 then
      raise exception using errcode = '22023', message = 'The upload idempotency key was reused with different file metadata';
    end if;
    return jsonb_build_object(
      'source_id', v_existing.id,
      'storage_path', v_existing.storage_path,
      'upload_expires_at', v_existing.upload_expires_at,
      'status', v_existing.status,
      'existing', true
    );
  end if;

  if (select count(*) from public.import_source_uploads s
      where s.created_by = v_actor and s.workspace_id = p_workspace_id
        and s.status in ('awaiting_upload', 'preview_queued', 'preview_processing')) >= 10 then
    raise exception using errcode = 'P0001', message = 'Too many imports are already being prepared';
  end if;

  v_content_type := case p_source_type
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    else 'text/csv'
  end;
  v_path := v_organization_id::text || '/' || p_workspace_id::text || '/' || v_source_id::text
    || '/' || v_nonce::text || '/source.' || p_source_type;

  insert into public.import_source_uploads (
    id, organization_id, workspace_id, created_by, import_kind, source_type,
    expected_content_type, expected_byte_size, expected_sha256, storage_path,
    upload_nonce, idempotency_key, upload_expires_at,
    object_deletion_status, object_deleted_at
  ) values (
    v_source_id, v_organization_id, p_workspace_id, v_actor, p_import_kind, p_source_type,
    v_content_type, p_expected_byte_size, p_expected_sha256, v_path,
    v_nonce, p_idempotency_key, statement_timestamp() + interval '15 minutes',
    'deleted', statement_timestamp()
  );

  return jsonb_build_object(
    'source_id', v_source_id,
    'storage_path', v_path,
    'upload_expires_at', statement_timestamp() + interval '15 minutes',
    'status', 'awaiting_upload',
    'existing', false
  );
end;
$$;

create or replace function public.finalize_async_import_source(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.import_source_uploads%rowtype;
  v_object storage.objects%rowtype;
  v_object_size bigint;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_source from public.import_source_uploads s
  where s.id = p_source_id and s.created_by = v_actor for update;
  if not found then
    raise exception using errcode = '42501', message = 'Upload access is required';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_source.workspace_id and w.organization_id = v_source.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if v_source.status <> 'awaiting_upload' then
    if v_source.finalized_at is not null then
      return jsonb_build_object('source_id', v_source.id, 'status', v_source.status, 'existing', true);
    end if;
    raise exception using errcode = '22023', message = 'The upload cannot be finalized in its current state';
  end if;
  if v_source.object_deletion_status <> 'retained'
     or v_source.upload_capability_safe_delete_at is null
     or v_source.object_deleted_at is not null then
    raise exception using errcode = '42501', message = 'A registered upload capability is required';
  end if;
  if v_source.upload_expires_at <= statement_timestamp() then
    update public.import_source_uploads
    set status = 'expired', error_code = 'upload_expired', error_message = 'The upload window expired.'
    where id = v_source.id;
    return jsonb_build_object('source_id', v_source.id, 'status', 'expired', 'existing', false);
  end if;

  select * into v_object from storage.objects o
  where o.bucket_id = v_source.storage_bucket and o.name = v_source.storage_path;
  if not found
     or coalesce(v_object.metadata ->> 'size', '') !~ '^[0-9]+$'
     or coalesce(v_object.metadata ->> 'mimetype', '') <> v_source.expected_content_type then
    raise exception using errcode = '22023', message = 'The uploaded object metadata is invalid';
  end if;
  v_object_size := (v_object.metadata ->> 'size')::bigint;
  if v_object_size <> v_source.expected_byte_size then
    raise exception using errcode = '22023', message = 'The uploaded byte count does not match the upload intent';
  end if;

  update public.import_source_uploads
  set status = 'preview_queued', finalized_at = statement_timestamp(),
      progress_current = 10, progress_label = 'Queued for secure preview'
  where id = v_source.id and status = 'awaiting_upload';

  insert into public.background_jobs (
    organization_id, workspace_id, job_type, status, idempotency_key,
    queue_name, max_attempts, payload_reference, progress_current, progress_total
  ) values (
    v_source.organization_id, v_source.workspace_id, 'process_import', 'queued',
    'import-source:' || v_source.id::text || ':preview:0', 'large-imports', 4,
    'import-source:' || v_source.id::text, 10, 100
  ) on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_build_object('source_id', v_source.id, 'status', 'preview_queued', 'existing', false);
end;
$$;

create or replace function public.worker_register_async_import_upload_capability(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
  v_organization_id uuid;
  v_workspace_id uuid;
  v_safe_delete_at timestamptz := statement_timestamp() + interval '2 hours 5 minutes';
begin
  perform app_private.require_service_role();
  select s.organization_id, s.workspace_id into v_organization_id, v_workspace_id
  from public.import_source_uploads s
  where s.id = p_source_id;
  if not found then
    raise exception using errcode = '22023', message = 'The import source does not exist';
  end if;

  perform 1 from public.organizations o
  where o.id = v_organization_id and o.status = 'active'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'The source organization is no longer active';
  end if;
  perform 1 from public.workspaces w
  where w.id = v_workspace_id and w.organization_id = v_organization_id and w.status = 'active'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'The source workspace is no longer active';
  end if;

  select * into v_source
  from public.import_source_uploads s
  where s.id = p_source_id
    and s.organization_id = v_organization_id
    and s.workspace_id = v_workspace_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'The import source does not exist';
  end if;
  if v_source.status <> 'awaiting_upload'
     or not (
       v_source.object_deletion_status = 'retained'
       or (
         v_source.object_deletion_status = 'deleted'
         and v_source.object_deleted_at is not null
         and v_source.upload_capability_safe_delete_at is null
       )
     )
     or v_source.upload_expires_at <= statement_timestamp() then
    raise exception using errcode = '22023', message = 'The upload intent is no longer eligible for a signed capability';
  end if;
  update public.import_source_uploads
  set upload_capability_safe_delete_at = greatest(
      coalesce(upload_capability_safe_delete_at, '-infinity'::timestamptz),
      v_safe_delete_at
    ),
    object_deletion_status = 'retained',
    object_deletion_requested_at = null,
    object_deleted_at = null,
    object_deletion_error_code = null
  where id = v_source.id
  returning upload_capability_safe_delete_at into v_safe_delete_at;
  return jsonb_build_object(
    'source_id', v_source.id,
    'storage_bucket', v_source.storage_bucket,
    'storage_path', v_source.storage_path,
    'safe_delete_at', v_safe_delete_at
  );
end;
$$;

create or replace function public.requeue_async_import_preview(p_source_id uuid, p_sheet_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.import_source_uploads%rowtype;
  v_generation integer;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_source from public.import_source_uploads s
  where s.id = p_source_id and s.created_by = v_actor for update;
  if not found or not app_private.can_edit_workspace(v_source.workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if v_source.status <> 'preview_ready'
     or p_sheet_name is null or not (v_source.sheet_names ? p_sheet_name) then
    raise exception using errcode = '22023', message = 'Choose a worksheet discovered in this source';
  end if;
  v_generation := v_source.preview_generation + 1;
  update public.import_source_uploads
  set status = 'preview_queued', requested_sheet = p_sheet_name,
      selected_sheet = null, source_headers = '[]'::jsonb, row_count = null,
      suggested_mapping = '{}'::jsonb, mapping_source = null, issue_summary = '[]'::jsonb,
      preview_generation = v_generation, progress_current = 10,
      progress_label = 'Queued to read the selected worksheet', workflow_run_id = null,
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = null, error_message = null
  where id = v_source.id;
  insert into public.background_jobs (
    organization_id, workspace_id, job_type, status, idempotency_key,
    queue_name, max_attempts, payload_reference, progress_current, progress_total
  ) values (
    v_source.organization_id, v_source.workspace_id, 'process_import', 'queued',
    'import-source:' || v_source.id::text || ':preview:' || v_generation::text,
    'large-imports', 4, 'import-source:' || v_source.id::text, 10, 100
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('source_id', v_source.id, 'status', 'preview_queued');
end;
$$;

create or replace function public.request_async_import_source_deletion(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.import_source_uploads%rowtype;
  v_request public.async_reconciliation_requests%rowtype;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  select * into v_source from public.import_source_uploads s
  where s.id = p_source_id and s.created_by = v_actor for update;
  if not found or not app_private.can_edit_workspace(v_source.workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if v_source.object_deletion_status = 'deleted' then
    return jsonb_build_object('source_id', v_source.id, 'deletion_status', 'deleted', 'existing', true);
  end if;
  select * into v_request from public.async_reconciliation_requests r
  where (r.invoice_source_id = v_source.id or r.payment_source_id = v_source.id)
    and r.status in ('queued', 'processing')
  order by r.created_at desc limit 1 for update;
  if found then
    update public.async_reconciliation_requests
    set status = 'cancelled', progress_label = 'Cancelled before durable save',
        completed_at = statement_timestamp(),
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = null, error_message = null
    where id = v_request.id;
    update public.background_jobs
    set status = 'cancelled', completed_at = statement_timestamp(), locked_at = null, locked_by = null
    where organization_id = v_request.organization_id
      and idempotency_key = 'async-reconciliation:' || v_request.id::text;
    update public.import_source_uploads
    set status = 'preview_ready', progress_label = 'Ready to map'
    where id in (v_request.invoice_source_id, v_request.payment_source_id)
      and id <> v_source.id;
  end if;
  update public.import_source_uploads
  set status = case when status = 'completed' then status else 'cancelled' end,
      progress_label = 'Private source deletion pending',
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      object_deletion_status = 'pending',
      object_deletion_requested_at = coalesce(object_deletion_requested_at, statement_timestamp())
  where id = v_source.id;
  return jsonb_build_object('source_id', v_source.id, 'deletion_status', 'pending', 'existing', false);
end;
$$;

create or replace function public.attach_async_import_workflow(p_source_id uuid, p_workflow_run_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if p_workflow_run_id is null or char_length(p_workflow_run_id) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'The workflow run identifier is invalid';
  end if;
  update public.import_source_uploads
  set workflow_run_id = coalesce(workflow_run_id, p_workflow_run_id)
  where id = p_source_id and status in ('preview_queued', 'preview_processing');
end;
$$;

create or replace function public.worker_claim_async_import_source(p_source_id uuid, p_step_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
  v_token text;
begin
  perform app_private.require_service_role();
  if p_step_id is null or char_length(p_step_id) not between 8 and 300 then
    raise exception using errcode = '22023', message = 'The worker step identifier is invalid';
  end if;
  select * into v_source from public.import_source_uploads s where s.id = p_source_id for update;
  if not found then raise exception using errcode = '22023', message = 'The import source does not exist'; end if;
  if v_source.status = 'preview_ready' then
    return jsonb_build_object('status', 'already_completed');
  end if;
  if v_source.status not in ('preview_queued', 'preview_processing') then
    raise exception using errcode = '22023', message = 'The import source is not available for preview';
  end if;
  if v_source.status = 'preview_processing'
     and v_source.worker_step_id is distinct from p_step_id
     and v_source.worker_claim_expires_at > statement_timestamp() then
    raise exception using errcode = '40001', message = 'Another worker owns this import source';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_source.created_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_source.workspace_id and w.organization_id = v_source.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The submitting member no longer has workspace access';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.import_source_uploads
  set status = 'preview_processing', worker_step_id = p_step_id,
      worker_claim_hash = app_private.worker_token_hash(v_token),
      worker_claim_expires_at = statement_timestamp() + interval '2 hours',
      progress_current = 25, progress_label = 'Validating and reading the source'
  where id = v_source.id;
  update public.background_jobs
  set status = 'running', attempts = least(attempts + 1, max_attempts),
      started_at = coalesce(started_at, statement_timestamp()), progress_current = 25,
      locked_at = statement_timestamp(), locked_by = left(p_step_id, 200)
  where organization_id = v_source.organization_id
    and idempotency_key = 'import-source:' || v_source.id::text || ':preview:' || v_source.preview_generation::text;
  return jsonb_build_object(
    'status', 'claimed', 'worker_token', v_token,
    'source_id', v_source.id, 'organization_id', v_source.organization_id,
    'workspace_id', v_source.workspace_id, 'created_by', v_source.created_by,
    'import_kind', v_source.import_kind, 'source_type', v_source.source_type,
    'expected_content_type', v_source.expected_content_type,
    'expected_byte_size', v_source.expected_byte_size,
    'expected_sha256', v_source.expected_sha256,
    'storage_bucket', v_source.storage_bucket, 'storage_path', v_source.storage_path,
    'requested_sheet', v_source.requested_sheet
  );
end;
$$;

create or replace function public.worker_complete_async_import_preview(
  p_source_id uuid,
  p_step_id text,
  p_worker_token text,
  p_observed_byte_size bigint,
  p_observed_sha256 text,
  p_source_headers jsonb,
  p_row_count integer,
  p_sheet_names jsonb,
  p_selected_sheet text,
  p_suggested_mapping jsonb,
  p_mapping_source text,
  p_issue_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_source from public.import_source_uploads s where s.id = p_source_id for update;
  if not found then raise exception using errcode = '22023', message = 'The import source does not exist'; end if;
  if v_source.status = 'preview_ready' then
    return jsonb_build_object('source_id', v_source.id, 'status', 'preview_ready', 'existing', true);
  end if;
  if v_source.status <> 'preview_processing'
     or v_source.worker_step_id is distinct from p_step_id
     or v_source.worker_claim_expires_at <= statement_timestamp()
     or v_source.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The import worker claim is invalid';
  end if;
  if p_observed_byte_size <> v_source.expected_byte_size
     or p_observed_sha256 is distinct from v_source.expected_sha256 then
    raise exception using errcode = '22023', message = 'The source bytes do not match the immutable upload intent';
  end if;
  if jsonb_typeof(p_source_headers) is distinct from 'array'
     or jsonb_array_length(p_source_headers) < 1 or jsonb_array_length(p_source_headers) > 256
     or octet_length(p_source_headers::text) > 262144
     or p_row_count not between 0 and 50000
     or jsonb_typeof(p_sheet_names) is distinct from 'array'
     or jsonb_array_length(p_sheet_names) > 20
     or jsonb_typeof(p_suggested_mapping) is distinct from 'object'
     or octet_length(p_suggested_mapping::text) > 65536
     or p_mapping_source not in ('saved', 'detected')
     or jsonb_typeof(p_issue_summary) is distinct from 'array'
     or jsonb_array_length(p_issue_summary) > 20
     or octet_length(p_issue_summary::text) > 32768
     or (p_selected_sheet is not null and not (p_sheet_names ? p_selected_sheet)) then
    raise exception using errcode = '22023', message = 'The safe import preview is invalid';
  end if;

  update public.import_source_uploads
  set status = 'preview_ready', selected_sheet = p_selected_sheet,
      sheet_names = p_sheet_names, source_headers = p_source_headers,
      row_count = p_row_count, suggested_mapping = p_suggested_mapping,
      mapping_source = p_mapping_source, issue_summary = p_issue_summary,
      progress_current = 100, progress_label = 'Ready to map',
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = null, error_message = null
  where id = v_source.id;
  update public.background_jobs
  set status = 'succeeded', progress_current = 100, completed_at = statement_timestamp(),
      locked_at = null, locked_by = null, error_code = null, error_summary = null
  where organization_id = v_source.organization_id
    and idempotency_key = 'import-source:' || v_source.id::text || ':preview:' || v_source.preview_generation::text;
  insert into public.user_notifications (
    user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
  ) values (
    v_source.created_by, v_source.organization_id, v_source.workspace_id,
    'import_preview_ready', v_source.id, 'Import ready to map',
    case when v_source.import_kind = 'invoice'
      then 'Your invoice source is validated and ready for column mapping.'
      else 'Your payment source is validated and ready for column mapping.' end,
    '/app/' || v_source.workspace_id::text || '/imports'
  ) on conflict (user_id, event_type, entity_id) do update
    set body = excluded.body, read_at = null, created_at = statement_timestamp();
  return jsonb_build_object('source_id', v_source.id, 'status', 'preview_ready', 'existing', false);
end;
$$;

create or replace function public.worker_fail_async_import_source(
  p_source_id uuid,
  p_step_id text,
  p_worker_token text,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_source from public.import_source_uploads s where s.id = p_source_id for update;
  if not found or v_source.status in ('preview_ready', 'completed', 'cancelled', 'expired') then return; end if;
  if v_source.worker_step_id is distinct from p_step_id
     or v_source.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The import worker claim is invalid';
  end if;
  update public.import_source_uploads
  set status = 'failed', progress_label = 'Import failed safely',
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = left(coalesce(nullif(p_error_code, ''), 'import_failed'), 100),
      error_message = left(coalesce(nullif(p_error_message, ''), 'The import could not be processed safely.'), 500)
  where id = v_source.id;
  update public.background_jobs
  set status = 'failed', completed_at = statement_timestamp(), locked_at = null, locked_by = null,
      error_code = left(coalesce(nullif(p_error_code, ''), 'import_failed'), 100),
      error_summary = left(coalesce(nullif(p_error_message, ''), 'The import could not be processed safely.'), 500)
  where organization_id = v_source.organization_id
    and idempotency_key = 'import-source:' || v_source.id::text || ':preview:' || v_source.preview_generation::text;
  insert into public.user_notifications (
    user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
  ) values (
    v_source.created_by, v_source.organization_id, v_source.workspace_id,
    'import_failed', v_source.id, 'Import needs attention',
    'The source could not be validated safely. Review the file requirements and try again.',
    '/app/' || v_source.workspace_id::text || '/imports'
  ) on conflict (user_id, event_type, entity_id) do update
    set body = excluded.body, read_at = null, created_at = statement_timestamp();
end;
$$;

create or replace function public.enqueue_async_reconciliation(
  p_workspace_id uuid,
  p_invoice_source_id uuid,
  p_payment_source_id uuid,
  p_invoice_mapping jsonb,
  p_payment_mapping jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_invoice public.import_source_uploads%rowtype;
  v_payment public.import_source_uploads%rowtype;
  v_existing public.async_reconciliation_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_plan_code text := 'free';
  v_plan_limit integer := 50;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_idempotency_key is null
     or jsonb_typeof(p_invoice_mapping) is distinct from 'object'
     or jsonb_typeof(p_payment_mapping) is distinct from 'object'
     or octet_length(p_invoice_mapping::text) > 65536
     or octet_length(p_payment_mapping::text) > 65536 then
    raise exception using errcode = '22023', message = 'The reconciliation request is invalid';
  end if;
  select * into v_existing from public.async_reconciliation_requests r
  where r.submitted_by = v_actor and r.workspace_id = p_workspace_id
    and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.invoice_source_id <> p_invoice_source_id
       or v_existing.payment_source_id <> p_payment_source_id
       or v_existing.invoice_mapping <> p_invoice_mapping
       or v_existing.payment_mapping <> p_payment_mapping then
      raise exception using errcode = '22023', message = 'The request idempotency key was reused with different inputs';
    end if;
    return jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'existing', true, 'allowed', true);
  end if;

  select * into v_invoice from public.import_source_uploads s
  where s.id = p_invoice_source_id and s.workspace_id = p_workspace_id
    and s.created_by = v_actor for update;
  select * into v_payment from public.import_source_uploads s
  where s.id = p_payment_source_id and s.workspace_id = p_workspace_id
    and s.created_by = v_actor for update;
  if v_invoice.id is null or v_payment.id is null
     or v_invoice.organization_id <> v_payment.organization_id
     or v_invoice.import_kind <> 'invoice' or v_payment.import_kind <> 'payment'
     or v_invoice.status <> 'preview_ready' or v_payment.status <> 'preview_ready' then
    raise exception using errcode = '42501', message = 'Both validated sources are required';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = p_workspace_id and w.organization_id = v_invoice.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if not (p_invoice_mapping ?& array['invoiceNumber','customerName','invoiceDate','originalAmount'])
     or not (p_payment_mapping ?& array['paymentDate','amount'])
     or exists (select 1 from jsonb_object_keys(p_invoice_mapping) as keys(key)
       where keys.key <> all(array['invoiceNumber','customerName','customerId','customerEmail','invoiceDate','dueDate','originalAmount','outstandingBalance','currency','status','reference','purchaseOrder','memo','accountId']))
     or exists (select 1 from jsonb_object_keys(p_payment_mapping) as keys(key)
       where keys.key <> all(array['paymentDate','amount','currency','payerName','payerId','description','bankReference','achId','wireId','memo','transactionId','accountId']))
     or exists (select 1 from jsonb_each_text(p_invoice_mapping) entry where not (v_invoice.source_headers ? entry.value))
     or exists (select 1 from jsonb_each_text(p_payment_mapping) entry where not (v_payment.source_headers ? entry.value)) then
    raise exception using errcode = '22023', message = 'Every required mapping must reference a discovered source header';
  end if;

  select s.plan_code into v_plan_code from public.subscriptions s
  where s.organization_id = v_invoice.organization_id
    and s.status in ('active', 'trialing', 'past_due');
  v_plan_code := coalesce(v_plan_code, 'free');
  v_plan_limit := case v_plan_code when 'solo' then 500 when 'business' then 2500 when 'bookkeeper' then 10000 else 50 end;
  if coalesce(v_payment.row_count, 0) > v_plan_limit then
    return jsonb_build_object(
      'allowed', false, 'code', 'payment_limit_exceeded', 'plan', v_plan_code,
      'limit', v_plan_limit, 'requested', v_payment.row_count
    );
  end if;

  insert into public.async_reconciliation_requests (
    id, organization_id, workspace_id, submitted_by, invoice_source_id,
    payment_source_id, invoice_mapping, payment_mapping, idempotency_key
  ) values (
    v_request_id, v_invoice.organization_id, p_workspace_id, v_actor,
    v_invoice.id, v_payment.id, p_invoice_mapping, p_payment_mapping, p_idempotency_key
  );
  update public.import_source_uploads set status = 'reconciling', progress_label = 'Queued for reconciliation'
  where id in (v_invoice.id, v_payment.id);
  insert into public.background_jobs (
    organization_id, workspace_id, job_type, status, idempotency_key,
    queue_name, max_attempts, payload_reference, progress_current, progress_total
  ) values (
    v_invoice.organization_id, p_workspace_id, 'run_matching', 'queued',
    'async-reconciliation:' || v_request_id::text, 'large-imports', 4,
    'async-reconciliation:' || v_request_id::text, 0, 100
  );
  return jsonb_build_object('request_id', v_request_id, 'status', 'queued', 'existing', false, 'allowed', true);
end;
$$;

create or replace function public.attach_async_reconciliation_workflow(p_request_id uuid, p_workflow_run_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if p_workflow_run_id is null or char_length(p_workflow_run_id) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'The workflow run identifier is invalid';
  end if;
  update public.async_reconciliation_requests
  set workflow_run_id = coalesce(workflow_run_id, p_workflow_run_id)
  where id = p_request_id and status in ('queued', 'processing');
end;
$$;

create or replace function public.worker_claim_async_reconciliation(p_request_id uuid, p_step_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
  v_invoice public.import_source_uploads%rowtype;
  v_payment public.import_source_uploads%rowtype;
  v_token text;
  v_plan_code text := 'free';
  v_plan_limit integer := 50;
begin
  perform app_private.require_service_role();
  if p_step_id is null or char_length(p_step_id) not between 8 and 300 then
    raise exception using errcode = '22023', message = 'The worker step identifier is invalid';
  end if;
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = '22023', message = 'The reconciliation request does not exist'; end if;
  if v_request.status = 'succeeded' then
    return jsonb_build_object('status', 'already_completed', 'summary', v_request.result_summary);
  end if;
  if v_request.status not in ('queued', 'processing') then
    raise exception using errcode = '22023', message = 'The reconciliation request cannot be processed';
  end if;
  if v_request.status = 'processing'
     and v_request.worker_step_id is distinct from p_step_id
     and v_request.worker_claim_expires_at > statement_timestamp() then
    raise exception using errcode = '40001', message = 'Another worker owns this reconciliation request';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_request.submitted_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_request.workspace_id and w.organization_id = v_request.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The submitting member no longer has workspace access';
  end if;
  select * into strict v_invoice from public.import_source_uploads where id = v_request.invoice_source_id;
  select * into strict v_payment from public.import_source_uploads where id = v_request.payment_source_id;
  if v_invoice.storage_path = '' or v_payment.storage_path = ''
     or v_invoice.status not in ('reconciling', 'completed')
     or v_payment.status not in ('reconciling', 'completed') then
    raise exception using errcode = '22023', message = 'The bound import sources are unavailable';
  end if;
  select s.plan_code into v_plan_code from public.subscriptions s
  where s.organization_id = v_request.organization_id
    and s.status in ('active', 'trialing', 'past_due');
  v_plan_code := coalesce(v_plan_code, 'free');
  v_plan_limit := case v_plan_code
    when 'solo' then 500 when 'business' then 2500 when 'bookkeeper' then 10000 else 50
  end;
  if v_payment.row_count is null or v_payment.row_count > v_plan_limit then
    update public.async_reconciliation_requests
    set status = 'failed', progress_label = 'Plan capacity changed',
        completed_at = statement_timestamp(),
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = 'payment_limit_exceeded',
        error_message = 'The current plan no longer permits this source volume.'
    where id = v_request.id;
    update public.import_source_uploads set status = 'preview_ready', progress_label = 'Ready to map'
    where id in (v_request.invoice_source_id, v_request.payment_source_id);
    update public.background_jobs
    set status = 'failed', completed_at = statement_timestamp(),
        error_code = 'payment_limit_exceeded', error_summary = 'The current plan capacity changed before processing.',
        locked_at = null, locked_by = null
    where organization_id = v_request.organization_id
      and idempotency_key = 'async-reconciliation:' || v_request.id::text;
    insert into public.user_notifications (
      user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
    ) values (
      v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
      'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
      'Your plan was rechecked before processing, and this source no longer fits the current allowance.',
      '/app/' || v_request.workspace_id::text || '/imports'
    ) on conflict (user_id, event_type, entity_id) do update
      set body = excluded.body, read_at = null, created_at = statement_timestamp();
    return jsonb_build_object(
      'status', 'plan_capacity_rejected', 'request_id', v_request.id,
      'workspace_id', v_request.workspace_id, 'submitted_by', v_request.submitted_by
    );
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.async_reconciliation_requests
  set status = 'processing', started_at = coalesce(started_at, statement_timestamp()),
      worker_step_id = p_step_id, worker_claim_hash = app_private.worker_token_hash(v_token),
      worker_claim_expires_at = statement_timestamp() + interval '2 hours',
      progress_current = 10, progress_label = 'Validating source files'
  where id = v_request.id;
  update public.background_jobs
  set status = 'running', attempts = least(attempts + 1, max_attempts),
      started_at = coalesce(started_at, statement_timestamp()), progress_current = 10,
      locked_at = statement_timestamp(), locked_by = left(p_step_id, 200)
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  return jsonb_build_object(
    'status', 'claimed', 'worker_token', v_token,
    'request_id', v_request.id, 'organization_id', v_request.organization_id,
    'workspace_id', v_request.workspace_id, 'submitted_by', v_request.submitted_by,
    'invoice_mapping', v_request.invoice_mapping, 'payment_mapping', v_request.payment_mapping,
    'invoice_source', jsonb_build_object(
      'id', v_invoice.id, 'source_type', v_invoice.source_type,
      'expected_byte_size', v_invoice.expected_byte_size, 'expected_sha256', v_invoice.expected_sha256,
      'storage_bucket', v_invoice.storage_bucket, 'storage_path', v_invoice.storage_path,
      'selected_sheet', v_invoice.selected_sheet
    ),
    'payment_source', jsonb_build_object(
      'id', v_payment.id, 'source_type', v_payment.source_type,
      'expected_byte_size', v_payment.expected_byte_size, 'expected_sha256', v_payment.expected_sha256,
      'storage_bucket', v_payment.storage_bucket, 'storage_path', v_payment.storage_path,
      'selected_sheet', v_payment.selected_sheet
    )
  );
end;
$$;

create or replace function app_private.async_worker_context_is_valid(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role' and exists (
    select 1
    from public.async_reconciliation_requests r
    join public.workspaces w on w.id = r.workspace_id and w.organization_id = r.organization_id and w.status = 'active'
    join public.organizations o on o.id = r.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = r.organization_id
      and m.user_id = r.submitted_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where r.id::text = current_setting('app.async_request_id', true)
      and r.workspace_id = target_workspace_id
      and r.status = 'processing'
      and r.worker_step_id = current_setting('app.async_step_id', true)
      and r.worker_claim_expires_at > statement_timestamp()
      and r.worker_claim_hash = app_private.worker_token_hash(current_setting('app.async_worker_token', true))
  )
$$;

create or replace function app_private.async_worker_actor(target_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when app_private.async_worker_context_is_valid(target_workspace_id) then (
    select r.submitted_by from public.async_reconciliation_requests r
    where r.id::text = current_setting('app.async_request_id', true)
      and r.workspace_id = target_workspace_id
  ) else null end
$$;

revoke all on function app_private.async_worker_context_is_valid(uuid) from public, anon, authenticated;
revoke all on function app_private.async_worker_actor(uuid) from public, anon, authenticated;

create or replace function public.worker_get_async_reconciliation_context(
  p_request_id uuid,
  p_step_id text,
  p_worker_token text,
  p_invoices jsonb,
  p_payments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found
     or v_request.status <> 'processing'
     or v_request.worker_step_id is distinct from p_step_id
     or v_request.worker_claim_expires_at <= statement_timestamp()
     or v_request.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The reconciliation worker claim is invalid';
  end if;
  perform set_config('app.async_request_id', v_request.id::text, true);
  perform set_config('app.async_step_id', p_step_id, true);
  perform set_config('app.async_worker_token', p_worker_token, true);
  if not app_private.async_worker_context_is_valid(v_request.workspace_id) then
    raise exception using errcode = '42501', message = 'The reconciliation worker context is invalid';
  end if;
  update public.async_reconciliation_requests
  set progress_current = 55, progress_label = 'Checking prior imports'
  where id = v_request.id;
  update public.background_jobs set progress_current = 55
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  return public.get_reconciliation_import_context(v_request.workspace_id, p_invoices, p_payments);
end;
$$;

create or replace function public.worker_complete_async_reconciliation(
  p_request_id uuid,
  p_step_id text,
  p_worker_token text,
  p_run_key text,
  p_engine_version text,
  p_billable_payment_count bigint,
  p_snapshot jsonb,
  p_invoice_import jsonb,
  p_payment_import jsonb,
  p_safe_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_plan_code text := 'free';
  v_limit bigint := 50;
  v_period_start date;
  v_period_end date;
  v_recorded bigint := 0;
  v_pending bigint := 0;
  v_existing_run_id uuid;
  v_existing_reservation public.reconciliation_usage_reservations%rowtype;
  v_result jsonb;
  v_now timestamptz := statement_timestamp();
begin
  perform app_private.require_service_role();
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found then raise exception using errcode = '22023', message = 'The reconciliation request does not exist'; end if;
  if v_request.status = 'succeeded' then
    return jsonb_build_object('allowed', true, 'status', 'succeeded', 'summary', v_request.result_summary, 'existing', true);
  end if;
  if v_request.status <> 'processing'
     or v_request.worker_step_id is distinct from p_step_id
     or v_request.worker_claim_expires_at <= v_now
     or v_request.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The reconciliation worker claim is invalid';
  end if;
  if not exists (
    select 1 from public.workspaces w
    join public.organizations o on o.id = w.organization_id and o.status = 'active'
    join public.memberships m on m.organization_id = w.organization_id
      and m.user_id = v_request.submitted_by and m.status = 'active' and m.role in ('owner', 'admin', 'member')
    where w.id = v_request.workspace_id and w.organization_id = v_request.organization_id and w.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The submitting member no longer has workspace access';
  end if;
  if p_billable_payment_count not between 0 and 50000
     or jsonb_typeof(p_safe_summary) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_safe_summary) as keys(key)
       where keys.key <> all(array['invoices','payments','matches','review','issues']))
     or not (p_safe_summary ?& array['invoices','payments','matches','review','issues'])
     or exists (select 1 from jsonb_each_text(p_safe_summary) entry where entry.value !~ '^[0-9]+$')
     or octet_length(p_safe_summary::text) > 4096 then
    raise exception using errcode = '22023', message = 'The reconciliation completion summary is invalid';
  end if;

  select * into v_subscription from public.subscriptions s
  where s.organization_id = v_request.organization_id;
  if found and v_subscription.status in ('active', 'trialing', 'past_due') then
    v_plan_code := v_subscription.plan_code;
  end if;
  v_limit := case v_plan_code when 'solo' then 500 when 'business' then 2500 when 'bookkeeper' then 10000 else 50 end;
  if v_plan_code <> 'free'
     and v_subscription.current_period_starts_at is not null
     and v_subscription.current_period_ends_at is not null
     and v_now >= v_subscription.current_period_starts_at
     and v_now < v_subscription.current_period_ends_at then
    v_period_start := (v_subscription.current_period_starts_at at time zone 'UTC')::date;
    v_period_end := ((v_subscription.current_period_ends_at - interval '1 microsecond') at time zone 'UTC')::date;
  else
    v_period_start := date_trunc('month', v_now at time zone 'UTC')::date;
    v_period_end := (date_trunc('month', v_now at time zone 'UTC') + interval '1 month' - interval '1 day')::date;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_request.organization_id::text || ':reconciliation-capacity:' || v_period_start::text || ':' || v_period_end::text, 0
  ));
  select r.id into v_existing_run_id from public.reconciliation_runs r
  where r.workspace_id = v_request.workspace_id and r.run_key = p_run_key and r.engine_version = p_engine_version;
  select * into v_existing_reservation from public.reconciliation_usage_reservations reservation
  where reservation.workspace_id = v_request.workspace_id
    and reservation.run_key = p_run_key and reservation.engine_version = p_engine_version for update;
  select coalesce(sum(u.quantity), 0) into v_recorded from public.usage_records u
  where u.organization_id = v_request.organization_id and u.metric_code = 'payments_processed'
    and u.period_start <= v_period_end and u.period_end >= v_period_start;
  select coalesce(sum(reservation.payment_count), 0) into v_pending
  from public.reconciliation_usage_reservations reservation
  where reservation.organization_id = v_request.organization_id
    and reservation.period_start = v_period_start and reservation.period_end = v_period_end
    and (v_existing_reservation.id is null or reservation.id <> v_existing_reservation.id)
    and ((reservation.status = 'reserved' and reservation.expires_at > v_now)
      or (reservation.status = 'committed' and not exists (
        select 1 from public.usage_records u where u.organization_id = reservation.organization_id
          and u.source_event_id = 'reconciliation-run:' || reservation.reconciliation_run_id::text || ':payments'
      )));
  if v_existing_run_id is null and v_recorded + v_pending + p_billable_payment_count > v_limit then
    update public.async_reconciliation_requests
    set status = 'failed', progress_label = 'Plan capacity reached', completed_at = v_now,
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = 'payment_limit_exceeded', error_message = 'This run exceeds the current payment processing allowance.'
    where id = v_request.id;
    update public.import_source_uploads set status = 'preview_ready', progress_label = 'Ready to map'
    where id in (v_request.invoice_source_id, v_request.payment_source_id);
    update public.background_jobs set status = 'failed', completed_at = v_now,
      error_code = 'payment_limit_exceeded', error_summary = 'The current plan capacity was reached.',
      locked_at = null, locked_by = null
    where organization_id = v_request.organization_id
      and idempotency_key = 'async-reconciliation:' || v_request.id::text;
    insert into public.user_notifications (
      user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
    ) values (
      v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
      'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
      'Your payment processing allowance was rechecked before saving, and this run does not fit the current plan.',
      '/app/' || v_request.workspace_id::text || '/imports'
    ) on conflict (user_id, event_type, entity_id) do update
      set body = excluded.body, read_at = null, created_at = v_now;
    return jsonb_build_object(
      'allowed', false, 'status', 'failed', 'code', 'payment_limit_exceeded',
      'plan', v_plan_code, 'limit', v_limit, 'used', v_recorded + v_pending,
      'requested', p_billable_payment_count
    );
  end if;

  if v_existing_run_id is null then
    insert into public.reconciliation_usage_reservations (
      organization_id, workspace_id, run_key, engine_version, period_start, period_end,
      plan_code, payment_count, status, reserved_by, expires_at
    ) values (
      v_request.organization_id, v_request.workspace_id, p_run_key, p_engine_version,
      v_period_start, v_period_end, v_plan_code, p_billable_payment_count,
      'reserved', v_request.submitted_by, v_now + interval '2 hours'
    ) on conflict (workspace_id, run_key, engine_version) do update set
      organization_id = excluded.organization_id, period_start = excluded.period_start,
      period_end = excluded.period_end, plan_code = excluded.plan_code,
      payment_count = excluded.payment_count, status = 'reserved',
      reconciliation_run_id = null, reserved_by = excluded.reserved_by,
      expires_at = excluded.expires_at;
  end if;

  perform set_config('app.async_request_id', v_request.id::text, true);
  perform set_config('app.async_step_id', p_step_id, true);
  perform set_config('app.async_worker_token', p_worker_token, true);
  if not app_private.async_worker_context_is_valid(v_request.workspace_id) then
    raise exception using errcode = '42501', message = 'The reconciliation worker context is invalid';
  end if;
  v_result := public.persist_reconciliation_run_v2(
    v_request.workspace_id, p_run_key, p_engine_version,
    p_snapshot, p_invoice_import, p_payment_import
  );
  delete from public.reconciliation_run_read_items i
  where i.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid;

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'invoice', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'invoiceNumber', source.value ->> 'customerName', source.value ->> 'reference')), 2000),
    source.value ->> 'status'
  from jsonb_array_elements(coalesce(p_snapshot -> 'invoices', '[]'::jsonb)) with ordinality as source(value, ordinality);

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'payment', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'payerName', source.value ->> 'description', source.value ->> 'transactionId', source.value ->> 'bankReference')), 2000),
    null
  from jsonb_array_elements(coalesce(p_snapshot -> 'payments', '[]'::jsonb)) with ordinality as source(value, ordinality);

  insert into public.reconciliation_run_read_items (
    reconciliation_run_id, organization_id, workspace_id, item_type,
    ordinal, item_id, item, search_text, status_code
  )
  select
    (v_result ->> 'run_record_id')::uuid, v_request.organization_id, v_request.workspace_id,
    'match', source.ordinality::integer, source.value ->> 'id', source.value,
    left(lower(concat_ws(' ', source.value ->> 'method', payment_terms.search_text, invoice_terms.search_text)), 2000),
    source.value ->> 'confidence'
  from jsonb_array_elements(coalesce(p_snapshot #> '{result,matches}', '[]'::jsonb)) with ordinality as source(value, ordinality)
  left join lateral (
    select string_agg(item.search_text, ' ' order by item.ordinal) as search_text
    from jsonb_array_elements_text(coalesce(source.value -> 'paymentIds', '[]'::jsonb)) as id(value)
    join public.reconciliation_run_read_items item
      on item.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid
      and item.item_type = 'payment' and item.item_id = id.value
  ) payment_terms on true
  left join lateral (
    select string_agg(item.search_text, ' ' order by item.ordinal) as search_text
    from jsonb_array_elements_text(coalesce(source.value -> 'invoiceIds', '[]'::jsonb)) as id(value)
    join public.reconciliation_run_read_items item
      on item.reconciliation_run_id = (v_result ->> 'run_record_id')::uuid
      and item.item_type = 'invoice' and item.item_id = id.value
  ) invoice_terms on true;

  update public.async_reconciliation_requests
  set status = 'succeeded', progress_current = 100, progress_label = 'Reconciliation ready',
      run_record_id = (v_result ->> 'run_record_id')::uuid, run_key = p_run_key,
      result_summary = p_safe_summary, completed_at = v_now,
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = null, error_message = null
  where id = v_request.id;
  update public.import_source_uploads set status = 'completed', progress_label = 'Reconciliation saved'
  where id in (v_request.invoice_source_id, v_request.payment_source_id);
  update public.background_jobs
  set status = 'succeeded', progress_current = 100, completed_at = v_now,
      locked_at = null, locked_by = null, error_code = null, error_summary = null
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  insert into public.user_notifications (
    user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
  ) values (
    v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
    'reconciliation_ready', v_request.id, 'Reconciliation ready',
    'Your background reconciliation is saved and ready for review.',
    '/app/' || v_request.workspace_id::text || '/exceptions'
  ) on conflict (user_id, event_type, entity_id) do update
    set body = excluded.body, read_at = null, created_at = v_now;
  return jsonb_build_object(
    'allowed', true, 'status', 'succeeded', 'existing', coalesce((v_result ->> 'existing')::boolean, false),
    'run_record_id', v_result ->> 'run_record_id', 'saved_at', v_result ->> 'saved_at',
    'summary', p_safe_summary
  );
end;
$$;

create or replace function public.worker_fail_async_reconciliation(
  p_request_id uuid,
  p_step_id text,
  p_worker_token text,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.async_reconciliation_requests%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_request from public.async_reconciliation_requests r where r.id = p_request_id for update;
  if not found or v_request.status in ('succeeded', 'cancelled', 'failed') then return; end if;
  if v_request.worker_step_id is distinct from p_step_id
     or v_request.worker_claim_hash is distinct from app_private.worker_token_hash(p_worker_token) then
    raise exception using errcode = '42501', message = 'The reconciliation worker claim is invalid';
  end if;
  update public.async_reconciliation_requests
  set status = 'failed', progress_label = 'Reconciliation failed safely', completed_at = statement_timestamp(),
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      error_code = left(coalesce(nullif(p_error_code, ''), 'reconciliation_failed'), 100),
      error_message = left(coalesce(nullif(p_error_message, ''), 'The reconciliation could not be completed safely.'), 500)
  where id = v_request.id;
  update public.import_source_uploads set status = 'preview_ready', progress_label = 'Ready to map'
  where id in (v_request.invoice_source_id, v_request.payment_source_id);
  update public.background_jobs
  set status = 'failed', completed_at = statement_timestamp(), locked_at = null, locked_by = null,
      error_code = left(coalesce(nullif(p_error_code, ''), 'reconciliation_failed'), 100),
      error_summary = left(coalesce(nullif(p_error_message, ''), 'The reconciliation could not be completed safely.'), 500)
  where organization_id = v_request.organization_id
    and idempotency_key = 'async-reconciliation:' || v_request.id::text;
  insert into public.user_notifications (
    user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
  ) values (
    v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
    'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
    'The run stopped safely before saving. Your validated sources remain available to retry.',
    '/app/' || v_request.workspace_id::text || '/imports'
  ) on conflict (user_id, event_type, entity_id) do update
    set body = excluded.body, read_at = null, created_at = statement_timestamp();
end;
$$;

create or replace function public.worker_cleanup_async_import_source(p_source_id uuid, p_force_retention boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
  v_request public.async_reconciliation_requests%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_source from public.import_source_uploads s where s.id = p_source_id for update;
  if not found then return jsonb_build_object('delete_object', false, 'deleted', true, 'status', 'missing_after_confirmed_tenant_delete'); end if;
  if v_source.object_deletion_status = 'deleted' and v_source.object_deleted_at is not null then
    return jsonb_build_object('delete_object', false, 'deleted', true, 'status', v_source.status);
  end if;
  if v_source.upload_capability_safe_delete_at is not null
     and v_source.upload_capability_safe_delete_at > statement_timestamp() then
    return jsonb_build_object(
      'delete_object', false,
      'deleted', false,
      'status', 'upload_capability_active',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_source.upload_capability_safe_delete_at - statement_timestamp())))::integer)
    );
  end if;
  if not p_force_retention
     and v_source.status = 'preview_processing'
     and v_source.worker_claim_expires_at <= statement_timestamp() then
    update public.import_source_uploads
    set status = 'expired', progress_label = 'A stale preview was removed',
        worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
        error_code = 'preview_claim_expired', error_message = 'The background preview claim expired.'
    where id = v_source.id;
    v_source.status := 'expired';
  elsif not p_force_retention
     and v_source.status not in ('awaiting_upload', 'failed', 'cancelled', 'expired') then
    return jsonb_build_object('delete_object', false, 'status', v_source.status);
  end if;
  if p_force_retention and v_source.retention_at > statement_timestamp()
     and v_source.status not in ('completed', 'failed', 'cancelled', 'expired') then
    return jsonb_build_object('delete_object', false, 'status', v_source.status);
  end if;
  if v_source.status = 'preview_processing'
     and v_source.worker_claim_expires_at > statement_timestamp() then
    return jsonb_build_object('delete_object', false, 'status', 'active_preview_claim');
  end if;
  if v_source.status = 'reconciling' then
    select * into v_request
    from public.async_reconciliation_requests r
    where (r.invoice_source_id = v_source.id or r.payment_source_id = v_source.id)
      and r.status in ('queued', 'processing')
    order by r.created_at desc
    limit 1
    for update;
    if found
       and v_request.status = 'processing'
       and v_request.worker_claim_expires_at > statement_timestamp() then
      return jsonb_build_object('delete_object', false, 'status', 'active_reconciliation_claim');
    end if;
    if found then
      update public.async_reconciliation_requests
      set status = 'failed', progress_label = 'Source retention window ended',
          completed_at = statement_timestamp(),
          worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
          error_code = 'source_retention_expired',
          error_message = 'The private source retention window ended before reconciliation completed.'
      where id = v_request.id;
      update public.import_source_uploads
      set status = 'expired', progress_label = 'Source retention window ended',
          worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null
      where id in (v_request.invoice_source_id, v_request.payment_source_id);
      update public.background_jobs
      set status = 'failed', completed_at = statement_timestamp(), locked_at = null, locked_by = null,
          error_code = 'source_retention_expired',
          error_summary = 'The private source retention window ended before processing completed.'
      where organization_id = v_request.organization_id
        and idempotency_key = 'async-reconciliation:' || v_request.id::text;
      insert into public.user_notifications (
        user_id, organization_id, workspace_id, event_type, entity_id, title, body, action_path
      ) values (
        v_request.submitted_by, v_request.organization_id, v_request.workspace_id,
        'reconciliation_failed', v_request.id, 'Reconciliation needs attention',
        'The private source retention window ended before the run completed. Upload the sources again to retry.',
        '/app/' || v_request.workspace_id::text || '/imports'
      ) on conflict (user_id, event_type, entity_id) do update
        set body = excluded.body, read_at = null, created_at = statement_timestamp();
      v_source.status := 'expired';
    end if;
  end if;
  update public.import_source_uploads
  set status = case when status = 'completed' then status else 'expired' end,
      progress_label = case when status = 'completed' then progress_label else 'Source retention period ended' end,
      worker_step_id = null, worker_claim_hash = null, worker_claim_expires_at = null,
      object_deletion_status = 'pending',
      object_deletion_requested_at = coalesce(object_deletion_requested_at, statement_timestamp())
  where id = v_source.id;
  return jsonb_build_object(
    'delete_object', true, 'deleted', false, 'status', v_source.status,
    'storage_bucket', v_source.storage_bucket, 'storage_path', v_source.storage_path
  );
end;
$$;

create or replace function public.worker_confirm_async_import_source_deleted(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.import_source_uploads%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_source
  from public.import_source_uploads s
  where s.id = p_source_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'The import source does not exist';
  end if;
  if v_source.upload_capability_safe_delete_at is not null
     and v_source.upload_capability_safe_delete_at > statement_timestamp() then
    raise exception using errcode = '42501', message = 'The signed upload capability has not expired';
  end if;
  if v_source.object_deletion_status not in ('pending', 'deleted') then
    raise exception using errcode = '22023', message = 'The import source is not pending deletion';
  end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = v_source.storage_bucket
      and object.name = v_source.storage_path
  ) then
    raise exception using errcode = '55000', message = 'Storage has not confirmed removal of the exact import source object';
  end if;
  update public.import_source_uploads
  set object_deletion_status = 'deleted', object_deleted_at = coalesce(object_deleted_at, statement_timestamp()),
      object_deletion_error_code = null
  where id = v_source.id;
end;
$$;

create or replace function public.worker_record_async_import_source_delete_retry(
  p_source_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if p_error_code is null or p_error_code !~ '^[a-z0-9_-]{1,100}$' then
    raise exception using errcode = '22023', message = 'The deletion retry code is invalid';
  end if;
  update public.import_source_uploads
  set object_deletion_status = 'pending',
      object_deletion_requested_at = coalesce(object_deletion_requested_at, statement_timestamp()),
      object_deletion_attempts = least(object_deletion_attempts + 1, 32767),
      object_deletion_error_code = p_error_code
  where id = p_source_id and object_deletion_status <> 'deleted';
end;
$$;

create or replace function public.worker_record_import_source_email_delivery(
  p_source_id uuid,
  p_status text,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if p_status not in ('sent', 'failed', 'skipped')
     or p_code is null or p_code !~ '^[a-z0-9_-]{1,100}$' then
    raise exception using errcode = '22023', message = 'The email delivery result is invalid';
  end if;
  update public.import_source_uploads
  set email_delivery_status = p_status, email_delivery_code = p_code
  where id = p_source_id and status in ('preview_ready', 'failed', 'completed');
end;
$$;

create or replace function public.worker_record_reconciliation_email_delivery(
  p_request_id uuid,
  p_status text,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_service_role();
  if p_status not in ('sent', 'failed', 'skipped')
     or p_code is null or p_code !~ '^[a-z0-9_-]{1,100}$' then
    raise exception using errcode = '22023', message = 'The email delivery result is invalid';
  end if;
  update public.async_reconciliation_requests
  set email_delivery_status = p_status, email_delivery_code = p_code
  where id = p_request_id and status in ('succeeded', 'failed');
end;
$$;

create or replace function public.get_latest_reconciliation_run_overview(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.reconciliation_runs%rowtype;
  v_metrics jsonb := '{}'::jsonb;
  v_preview jsonb := '[]'::jsonb;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_access_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;
  select r.* into v_run
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id and r.status = 'completed'
  order by r.completed_at desc, r.id desc
  limit 1;
  if not found then return jsonb_build_object('status', 'empty'); end if;
  if not exists (
    select 1 from public.reconciliation_run_read_items item
    where item.reconciliation_run_id = v_run.id
  ) then
    return jsonb_build_object(
      'status', 'ready', 'read_model', false,
      'run_record_id', v_run.id, 'run_key', v_run.run_key, 'completed_at', v_run.completed_at
    );
  end if;

  with latest_decisions as (
    select distinct on (a.new_state #>> '{decision,matchId}')
      a.new_state #>> '{decision,matchId}' as match_id,
      a.new_state #>> '{decision,outcome}' as outcome
    from public.reconciliation_actions a
    where a.reconciliation_run_id = v_run.id
      and jsonb_typeof(a.new_state -> 'decision') = 'object'
      and nullif(a.new_state #>> '{decision,matchId}', '') is not null
    order by a.new_state #>> '{decision,matchId}', a.created_at desc, a.id desc
  ), latest_balances as (
    select distinct on (balance.key)
      balance.key as invoice_id, balance.value::bigint as balance_minor
    from public.reconciliation_actions a
    cross join lateral jsonb_each_text(coalesce(a.new_state -> 'invoiceBalances', '{}'::jsonb)) balance
    where a.reconciliation_run_id = v_run.id and balance.value ~ '^[0-9]+$'
    order by balance.key, a.created_at desc, a.id desc
  ), match_metrics as (
    select
      count(*)::integer as total,
      count(*) filter (where d.outcome = 'confirmed')::integer as confirmed,
      count(*) filter (where d.match_id is null and m.status_code in ('exact', 'high_confidence'))::integer as suggested,
      count(*) filter (where d.match_id is null and m.status_code = 'review')::integer as review,
      count(*) filter (where d.outcome in ('rejected', 'unmatched') or (d.match_id is null and m.status_code = 'unmatched'))::integer as unmatched,
      count(*) filter (where d.match_id is null and m.status_code in ('review', 'unmatched'))::integer as exceptions
    from public.reconciliation_run_read_items m
    left join latest_decisions d on d.match_id = m.item_id
    where m.reconciliation_run_id = v_run.id and m.item_type = 'match'
  ), record_metrics as (
    select
      count(*) filter (where item.item_type = 'invoice')::integer as invoices,
      count(*) filter (where item.item_type = 'payment')::integer as payments,
      coalesce(sum(coalesce(balance.balance_minor, (item.item ->> 'outstandingAmountMinor')::bigint))
        filter (where item.item_type = 'invoice'), 0)::bigint as open_invoice_balance
    from public.reconciliation_run_read_items item
    left join latest_balances balance on balance.invoice_id = item.item_id and item.item_type = 'invoice'
    where item.reconciliation_run_id = v_run.id
  )
  select jsonb_build_object(
    'invoices', record_metrics.invoices,
    'payments', record_metrics.payments,
    'matches', match_metrics.total,
    'confirmed', match_metrics.confirmed,
    'suggested', match_metrics.suggested,
    'review', match_metrics.review,
    'unmatched', match_metrics.unmatched,
    'exceptions', match_metrics.exceptions,
    'openInvoiceBalanceMinor', record_metrics.open_invoice_balance
  ) into v_metrics
  from match_metrics cross join record_metrics;

  with latest_decisions as (
    select distinct on (a.new_state #>> '{decision,matchId}')
      a.new_state #>> '{decision,matchId}' as match_id
    from public.reconciliation_actions a
    where a.reconciliation_run_id = v_run.id
      and jsonb_typeof(a.new_state -> 'decision') = 'object'
      and nullif(a.new_state #>> '{decision,matchId}', '') is not null
    order by a.new_state #>> '{decision,matchId}', a.created_at desc, a.id desc
  ), selected as (
    select m.item, payment.item as payment
    from public.reconciliation_run_read_items m
    left join latest_decisions d on d.match_id = m.item_id
    left join public.reconciliation_run_read_items payment
      on payment.reconciliation_run_id = m.reconciliation_run_id
      and payment.item_type = 'payment'
      and payment.item_id = m.item #>> '{paymentIds,0}'
    where m.reconciliation_run_id = v_run.id and m.item_type = 'match'
      and d.match_id is null and m.status_code in ('review', 'unmatched')
    order by m.ordinal
    limit 4
  )
  select coalesce(jsonb_agg(jsonb_build_object('match', item, 'payment', payment)), '[]'::jsonb)
  into v_preview from selected;

  return jsonb_build_object(
    'status', 'ready', 'read_model', true,
    'run_record_id', v_run.id, 'run_key', v_run.run_key, 'completed_at', v_run.completed_at,
    'currency', coalesce(v_run.snapshot #>> '{invoices,0,currency}', v_run.snapshot #>> '{payments,0,currency}', 'USD'),
    'metrics', v_metrics, 'preview', v_preview,
    'source_files', coalesce(v_run.snapshot -> 'sourceFiles', 'null'::jsonb),
    'reconciliation_context', coalesce(v_run.snapshot -> 'reconciliationContext', 'null'::jsonb)
  );
end;
$$;

create or replace function public.get_latest_reconciliation_run_items(
  p_workspace_id uuid,
  p_item_type text,
  p_offset integer default 0,
  p_limit integer default 50,
  p_search text default '',
  p_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.reconciliation_runs%rowtype;
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_decisions jsonb := '{}'::jsonb;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_access_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;
  if p_item_type not in ('invoice', 'payment', 'match')
     or p_offset not between 0 and 100000
     or p_limit not between 1 and 100
     or char_length(v_search) > 100
     or char_length(coalesce(p_status, '')) > 30 then
    raise exception using errcode = '22023', message = 'The result page request is invalid';
  end if;
  if (p_item_type = 'invoice' and p_status not in ('all', 'open', 'partially_paid', 'paid', 'void'))
     or (p_item_type = 'match' and p_status not in ('all', 'exact', 'high', 'review', 'unmatched'))
     or (p_item_type = 'payment' and p_status <> 'all') then
    raise exception using errcode = '22023', message = 'The result page filter is invalid';
  end if;
  select r.* into v_run
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id and r.status = 'completed'
  order by r.completed_at desc, r.id desc limit 1;
  if not found then return jsonb_build_object('status', 'empty'); end if;
  if not exists (
    select 1 from public.reconciliation_run_read_items item
    where item.reconciliation_run_id = v_run.id
  ) then
    return jsonb_build_object('status', 'legacy');
  end if;

  select count(*)::integer into v_total
  from public.reconciliation_run_read_items item
  where item.reconciliation_run_id = v_run.id and item.item_type = p_item_type
    and (v_search = '' or item.search_text like '%' || v_search || '%')
    and (p_status = 'all'
      or (p_item_type = 'match' and item.status_code = case when p_status = 'high' then 'high_confidence' else p_status end)
      or (p_item_type = 'invoice' and item.status_code = p_status));

  with selected as (
    select item.*
    from public.reconciliation_run_read_items item
    where item.reconciliation_run_id = v_run.id and item.item_type = p_item_type
      and (v_search = '' or item.search_text like '%' || v_search || '%')
      and (p_status = 'all'
        or (p_item_type = 'match' and item.status_code = case when p_status = 'high' then 'high_confidence' else p_status end)
        or (p_item_type = 'invoice' and item.status_code = p_status))
    order by item.ordinal
    offset p_offset limit p_limit
  )
  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb) into v_items from selected;

  if p_item_type = 'match' then
    select coalesce(jsonb_object_agg(
      a.new_state #>> '{decision,matchId}', a.new_state -> 'decision'
    ), '{}'::jsonb)
    into v_decisions
    from (
      select distinct on (action.new_state #>> '{decision,matchId}') action.*
      from public.reconciliation_actions action
      where action.reconciliation_run_id = v_run.id
        and action.new_state #>> '{decision,matchId}' in (
          select value ->> 'id' from jsonb_array_elements(v_items) value
        )
      order by action.new_state #>> '{decision,matchId}', action.created_at desc, action.id desc
    ) a;

    select coalesce(jsonb_agg(item.item order by item.ordinal), '[]'::jsonb)
    into v_payments
    from public.reconciliation_run_read_items item
    where item.reconciliation_run_id = v_run.id and item.item_type = 'payment'
      and item.item_id in (
        select id.value
        from jsonb_array_elements(v_items) match_item
        cross join lateral jsonb_array_elements_text(coalesce(match_item.value -> 'paymentIds', '[]'::jsonb)) id(value)
      );

    with related as (
      select item.*
      from public.reconciliation_run_read_items item
      where item.reconciliation_run_id = v_run.id and item.item_type = 'invoice'
        and (
          item.item_id in (
            select id.value
            from jsonb_array_elements(v_items) match_item
            cross join lateral jsonb_array_elements_text(coalesce(match_item.value -> 'invoiceIds', '[]'::jsonb)) id(value)
            union
            select id.value
            from jsonb_array_elements(v_items) match_item
            cross join lateral jsonb_array_elements_text(coalesce(match_item.value -> 'candidateInvoiceIds', '[]'::jsonb)) id(value)
          )
          or item.item_id in (
            select id.value
            from jsonb_each(v_decisions) decision
            cross join lateral jsonb_array_elements_text(coalesce(decision.value -> 'invoiceIds', '[]'::jsonb)) id(value)
          )
        )
    )
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(related.item, '{outstandingAmountMinor}', to_jsonb(coalesce(balance.balance_minor, (related.item ->> 'outstandingAmountMinor')::bigint))),
        '{status}',
        to_jsonb(case
          when related.item ->> 'status' = 'void' then 'void'
          when coalesce(balance.balance_minor, (related.item ->> 'outstandingAmountMinor')::bigint) = 0 then 'paid'
          when coalesce(balance.balance_minor, (related.item ->> 'outstandingAmountMinor')::bigint) < (related.item ->> 'originalAmountMinor')::bigint then 'partially_paid'
          else 'open'
        end)
      ) order by related.ordinal
    ), '[]'::jsonb) into v_invoices
    from related
    left join lateral (
      select entry.value::bigint as balance_minor
      from public.reconciliation_actions action
      cross join lateral jsonb_each_text(coalesce(action.new_state -> 'invoiceBalances', '{}'::jsonb)) entry
      where action.reconciliation_run_id = v_run.id and entry.key = related.item_id and entry.value ~ '^[0-9]+$'
      order by action.created_at desc, action.id desc limit 1
    ) balance on true;
  elsif p_item_type = 'invoice' then
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(value, '{outstandingAmountMinor}', to_jsonb(coalesce(balance.balance_minor, (value ->> 'outstandingAmountMinor')::bigint))),
        '{status}',
        to_jsonb(case
          when value ->> 'status' = 'void' then 'void'
          when coalesce(balance.balance_minor, (value ->> 'outstandingAmountMinor')::bigint) = 0 then 'paid'
          when coalesce(balance.balance_minor, (value ->> 'outstandingAmountMinor')::bigint) < (value ->> 'originalAmountMinor')::bigint then 'partially_paid'
          else 'open'
        end)
      )
    ), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_items) value
    left join lateral (
      select entry.value::bigint as balance_minor
      from public.reconciliation_actions action
      cross join lateral jsonb_each_text(coalesce(action.new_state -> 'invoiceBalances', '{}'::jsonb)) entry
      where action.reconciliation_run_id = v_run.id and entry.key = value ->> 'id' and entry.value ~ '^[0-9]+$'
      order by action.created_at desc, action.id desc limit 1
    ) balance on true;
  end if;

  return jsonb_build_object(
    'status', 'ready', 'run_record_id', v_run.id, 'run_key', v_run.run_key,
    'completed_at', v_run.completed_at, 'item_type', p_item_type,
    'offset', p_offset, 'limit', p_limit, 'total', v_total,
    'has_more', p_offset + p_limit < v_total, 'items', v_items,
    'related_invoices', v_invoices, 'related_payments', v_payments, 'decisions', v_decisions
  );
end;
$$;

revoke all on public.import_source_uploads, public.async_reconciliation_requests, public.user_notifications,
  public.reconciliation_run_read_items
from public, anon, authenticated;
revoke insert, update, delete, truncate on public.import_source_uploads, public.async_reconciliation_requests
from service_role;
grant select on public.import_source_uploads, public.async_reconciliation_requests to service_role;
grant select on public.import_source_uploads, public.async_reconciliation_requests, public.user_notifications
to authenticated;
grant update (read_at) on public.user_notifications to authenticated;

revoke all on function public.get_latest_reconciliation_run_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_latest_reconciliation_run_overview(uuid) to authenticated;
revoke all on function public.get_latest_reconciliation_run_items(uuid, text, integer, integer, text, text)
from public, anon, authenticated;
grant execute on function public.get_latest_reconciliation_run_items(uuid, text, integer, integer, text, text)
to authenticated;

revoke all on function public.initialize_async_import_source(uuid, text, text, bigint, text, uuid)
from public, anon, authenticated;
grant execute on function public.initialize_async_import_source(uuid, text, text, bigint, text, uuid)
to authenticated;
revoke all on function public.finalize_async_import_source(uuid) from public, anon, authenticated;
grant execute on function public.finalize_async_import_source(uuid) to authenticated;
revoke all on function public.requeue_async_import_preview(uuid, text) from public, anon, authenticated;
grant execute on function public.requeue_async_import_preview(uuid, text) to authenticated;
revoke all on function public.request_async_import_source_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_async_import_source_deletion(uuid) to authenticated;
revoke all on function public.enqueue_async_reconciliation(uuid, uuid, uuid, jsonb, jsonb, uuid)
from public, anon, authenticated;
grant execute on function public.enqueue_async_reconciliation(uuid, uuid, uuid, jsonb, jsonb, uuid)
to authenticated;

revoke all on function public.attach_async_import_workflow(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_register_async_import_upload_capability(uuid) from public, anon, authenticated;
revoke all on function public.worker_claim_async_import_source(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_complete_async_import_preview(uuid, text, text, bigint, text, jsonb, integer, jsonb, text, jsonb, text, jsonb)
from public, anon, authenticated;
revoke all on function public.worker_fail_async_import_source(uuid, text, text, text, text)
from public, anon, authenticated;
revoke all on function public.attach_async_reconciliation_workflow(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_claim_async_reconciliation(uuid, text) from public, anon, authenticated;
revoke all on function public.worker_get_async_reconciliation_context(uuid, text, text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.worker_complete_async_reconciliation(uuid, text, text, text, text, bigint, jsonb, jsonb, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.worker_fail_async_reconciliation(uuid, text, text, text, text)
from public, anon, authenticated;
revoke all on function public.worker_cleanup_async_import_source(uuid, boolean)
from public, anon, authenticated;
revoke all on function public.worker_confirm_async_import_source_deleted(uuid)
from public, anon, authenticated;
revoke all on function public.worker_record_async_import_source_delete_retry(uuid, text)
from public, anon, authenticated;
revoke all on function public.worker_record_import_source_email_delivery(uuid, text, text)
from public, anon, authenticated;
revoke all on function public.worker_record_reconciliation_email_delivery(uuid, text, text)
from public, anon, authenticated;

grant execute on function public.attach_async_import_workflow(uuid, text) to service_role;
grant execute on function public.worker_register_async_import_upload_capability(uuid) to service_role;
grant execute on function public.worker_claim_async_import_source(uuid, text) to service_role;
grant execute on function public.worker_complete_async_import_preview(uuid, text, text, bigint, text, jsonb, integer, jsonb, text, jsonb, text, jsonb)
to service_role;
grant execute on function public.worker_fail_async_import_source(uuid, text, text, text, text) to service_role;
grant execute on function public.attach_async_reconciliation_workflow(uuid, text) to service_role;
grant execute on function public.worker_claim_async_reconciliation(uuid, text) to service_role;
grant execute on function public.worker_get_async_reconciliation_context(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.worker_complete_async_reconciliation(uuid, text, text, text, text, bigint, jsonb, jsonb, jsonb, jsonb)
to service_role;
grant execute on function public.worker_fail_async_reconciliation(uuid, text, text, text, text) to service_role;
grant execute on function public.worker_cleanup_async_import_source(uuid, boolean) to service_role;
grant execute on function public.worker_confirm_async_import_source_deleted(uuid) to service_role;
grant execute on function public.worker_record_async_import_source_delete_retry(uuid, text) to service_role;
grant execute on function public.worker_record_import_source_email_delivery(uuid, text, text) to service_role;
grant execute on function public.worker_record_reconciliation_email_delivery(uuid, text, text) to service_role;

comment on table public.import_source_uploads is
  'Immutable, actor-bound upload intents and safe background preview state. Original filenames and row values are intentionally excluded.';
comment on table public.async_reconciliation_requests is
  'Durable user intent and safe progress for one background reconciliation. Full financial payloads never enter this table.';
comment on table public.user_notifications is
  'Workspace-scoped, user-owned readiness and failure notifications with no financial details.';
comment on table public.reconciliation_run_read_items is
  'Bounded server-side read model for saved large runs. Direct tenant DML is denied; authorized RPCs return capped pages.';

commit;
