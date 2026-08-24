begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

create or replace function pg_temp.try_sql(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return '00000';
exception when others then
  return sqlstate;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'async-owner-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'async-viewer-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'async-owner-b@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, created_by)
values
  ('30000000-0000-4000-8000-000000000001', 'Async tenant A', 'd0000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000001', 'Async tenant B', 'e0000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000001', 'Async deletion tenant', 'd0000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role, status, joined_at)
values
  ('30000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('30000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'viewer', 'active', now()),
  ('40000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('50000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner', 'active', now());

insert into public.workspaces (id, organization_id, name, business_name, created_by)
values
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Async A', 'Async A', 'd0000000-0000-4000-8000-000000000001'),
  ('41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Async B', 'Async B', 'e0000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Pristine intent', 'Pristine intent', 'd0000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 'Retained source', 'Retained source', 'd0000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $sql$select public.initialize_async_import_source('31000000-0000-4000-8000-000000000001', 'invoice', 'csv', 12, repeat('a', 64), '61000000-0000-4000-8000-000000000001')$sql$,
  'tenant A editor can initialize an actor-bound source intent'
);
select is(
  (select object_deletion_status from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
  'deleted',
  'a source with no issued upload capability is represented by a no-object receipt'
);
select ok(
  (select storage_path ~ ('^30000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000001/' || id::text || '/[0-9a-f-]+/source\.csv$')
   from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
  'the private object path is server-derived from the immutable tenant and source intent'
);
select is(
  pg_temp.try_sql($sql$update public.import_source_uploads set storage_path = 'other/path.csv' where idempotency_key = '61000000-0000-4000-8000-000000000001'$sql$),
  '42501',
  'authenticated clients cannot mutate a source path or other source metadata directly'
);

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.import_source_uploads where workspace_id = '31000000-0000-4000-8000-000000000001'),
  0::bigint,
  'tenant B cannot select tenant A source intents'
);
select is(
  pg_temp.try_sql($sql$select public.finalize_async_import_source((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$),
  '42501',
  'tenant B cannot finalize tenant A source'
);
select is(
  pg_temp.try_sql($sql$select public.requeue_async_import_preview((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'), 'Sheet1')$sql$),
  '42501',
  'tenant B cannot requeue tenant A source'
);
select is(
  pg_temp.try_sql($sql$select public.request_async_import_source_deletion((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$),
  '42501',
  'tenant B cannot request deletion of tenant A source'
);
select is(
  pg_temp.try_sql($sql$select public.enqueue_async_reconciliation(
    '31000000-0000-4000-8000-000000000001',
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
    '{}'::jsonb, '{}'::jsonb, '61000000-0000-4000-8000-000000000002'
  )$sql$),
  '42501',
  'tenant B cannot enqueue tenant A sources'
);

select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000002', true);
select is(
  pg_temp.try_sql($sql$select public.initialize_async_import_source('31000000-0000-4000-8000-000000000001', 'payment', 'csv', 12, repeat('b', 64), '61000000-0000-4000-8000-000000000003')$sql$),
  '42501',
  'a viewer cannot initialize a source intent'
);
select is(
  pg_temp.try_sql($sql$select public.worker_cleanup_async_import_source(gen_random_uuid(), true)$sql$),
  '42501',
  'an authenticated user cannot execute a cleanup worker RPC'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  pg_temp.try_sql($sql$update public.import_source_uploads set progress_current = 1 where false$sql$),
  '42501',
  'service role cannot update source state outside constrained worker RPCs'
);
select is(
  pg_temp.try_sql($sql$delete from public.import_source_uploads where false$sql$),
  '42501',
  'service role cannot delete source metadata outside constrained worker RPCs'
);
select is(
  pg_temp.try_sql($sql$insert into public.import_source_uploads default values$sql$),
  '42501',
  'service role cannot insert source metadata outside constrained worker RPCs'
);
select lives_ok(
  $sql$select public.worker_register_async_import_upload_capability((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$,
  'service worker can register the exact signed-upload capability'
);
select ok(
  (select object_deletion_status = 'retained'
      and object_deleted_at is null
      and upload_capability_safe_delete_at >= statement_timestamp() + interval '2 hours'
   from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
  'capability registration atomically enters retained state and covers the provider token lifetime'
);

reset role;
insert into storage.objects (bucket_id, name, metadata)
select storage_bucket, storage_path, jsonb_build_object('size', expected_byte_size::text, 'mimetype', expected_content_type)
from public.import_source_uploads
where idempotency_key = '61000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $sql$select public.finalize_async_import_source((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$,
  'the creator can finalize only after capability registration and exact object metadata validation'
);

reset role;
update public.memberships set status = 'removed'
where organization_id = '30000000-0000-4000-8000-000000000001'
  and user_id = 'd0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  pg_temp.try_sql($sql$select public.worker_claim_async_import_source(
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'), 'revoked-member-step'
  )$sql$),
  '42501',
  'a service worker claim fails after the submitting editor membership is revoked'
);

reset role;
update public.memberships set status = 'active'
where organization_id = '30000000-0000-4000-8000-000000000001'
  and user_id = 'd0000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $sql$select public.worker_claim_async_import_source(
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'), 'preview-stale-step'
  )$sql$,
  'an active editor source can receive a scoped preview claim'
);

reset role;
update public.import_source_uploads
set worker_claim_expires_at = statement_timestamp() - interval '1 minute',
    upload_capability_safe_delete_at = statement_timestamp() - interval '1 minute',
    retention_at = statement_timestamp() - interval '1 minute'
where idempotency_key = '61000000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.worker_cleanup_async_import_source(
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'), false
  ) #>> '{delete_object}',
  'true',
  'cleanup reclaims an expired preview lease and returns only its immutable exact path'
);
select ok(
  (select status = 'expired' and object_deletion_status = 'pending' and object_deleted_at is null
   from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
  'stale preview cleanup becomes deletion-pending without falsely claiming object removal'
);
select is(
  pg_temp.try_sql($sql$select public.worker_confirm_async_import_source_deleted((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$),
  '55000',
  'deletion confirmation fails while the exact private Storage object still exists'
);

reset role;
delete from storage.objects
where bucket_id = 'import-source-files'
  and name = (
    select storage_path from public.import_source_uploads
    where idempotency_key = '61000000-0000-4000-8000-000000000001'
  );
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $sql$select public.worker_confirm_async_import_source_deleted((select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'))$sql$,
  'a service worker can record deletion only after the exact-path removal step succeeds'
);
select ok(
  (select object_deletion_status = 'deleted' and object_deleted_at is not null
   from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000001'),
  'confirmed removal has a durable deletion receipt'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $sql$select public.initialize_async_import_source('31000000-0000-4000-8000-000000000001', 'payment', 'csv', 12, repeat('c', 64), '61000000-0000-4000-8000-000000000004')$sql$,
  'a second source intent can be created for stale reconciliation cleanup coverage'
);

reset role;
update public.import_source_uploads
set status = 'reconciling', object_deletion_status = 'retained', object_deleted_at = null,
    upload_capability_safe_delete_at = statement_timestamp() - interval '1 minute',
    retention_at = statement_timestamp() - interval '1 minute'
where idempotency_key in ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004');
insert into public.async_reconciliation_requests (
  id, organization_id, workspace_id, submitted_by, invoice_source_id, payment_source_id,
  invoice_mapping, payment_mapping, idempotency_key, status,
  worker_step_id, worker_claim_hash, worker_claim_expires_at
)
select
  '62000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  max(id) filter (where import_kind = 'invoice'),
  max(id) filter (where import_kind = 'payment'),
  '{}'::jsonb, '{}'::jsonb, '62000000-0000-4000-8000-000000000002', 'processing',
  'stale-reconciliation-step', repeat('d', 64), statement_timestamp() - interval '1 minute'
from public.import_source_uploads
where idempotency_key in ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.worker_cleanup_async_import_source(
    (select id from public.import_source_uploads where idempotency_key = '61000000-0000-4000-8000-000000000004'), true
  ) #>> '{delete_object}',
  'true',
  'forced retention cleanup reclaims an expired reconciliation lease'
);
select ok(
  (select request.status = 'failed'
      and source.object_deletion_status = 'pending'
      and source.object_deleted_at is null
   from public.async_reconciliation_requests request
   join public.import_source_uploads source on source.id = request.payment_source_id
   where request.id = '62000000-0000-4000-8000-000000000001'),
  'stale reconciliation cleanup fails the request safely and keeps object deletion pending'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $sql$select public.initialize_async_import_source('51000000-0000-4000-8000-000000000001', 'invoice', 'csv', 12, repeat('e', 64), '63000000-0000-4000-8000-000000000001')$sql$,
  'a pristine never-issued source can be initialized without creating an object'
);

reset role;
select lives_ok(
  $sql$delete from public.workspaces where id = '51000000-0000-4000-8000-000000000001'$sql$,
  'a pristine no-capability intent cannot permanently fence workspace deletion'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $sql$select public.initialize_async_import_source('51000000-0000-4000-8000-000000000002', 'invoice', 'csv', 12, repeat('f', 64), '63000000-0000-4000-8000-000000000002')$sql$,
  'the deletion-fence workspace can initialize a source'
);
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $sql$select public.worker_register_async_import_upload_capability((select id from public.import_source_uploads where idempotency_key = '63000000-0000-4000-8000-000000000002'))$sql$,
  'the deletion-fence source enters retained state only through capability registration'
);

reset role;
select is(
  pg_temp.try_sql($sql$delete from public.workspaces where id = '51000000-0000-4000-8000-000000000002'$sql$),
  '55000',
  'workspace deletion is blocked while a private object lacks a deletion receipt'
);
select is(
  pg_temp.try_sql($sql$delete from public.organizations where id = '50000000-0000-4000-8000-000000000001'$sql$),
  '55000',
  'organization deletion is blocked while a private object lacks a deletion receipt'
);

update public.import_source_uploads
set object_deletion_status = 'pending', object_deletion_requested_at = statement_timestamp(),
    upload_capability_safe_delete_at = statement_timestamp() - interval '1 minute'
where idempotency_key = '63000000-0000-4000-8000-000000000002';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $sql$select public.worker_confirm_async_import_source_deleted((select id from public.import_source_uploads where idempotency_key = '63000000-0000-4000-8000-000000000002'))$sql$,
  'verified exact-path removal can write the tenant-deletion receipt'
);

reset role;
select lives_ok(
  $sql$delete from public.workspaces where id = '51000000-0000-4000-8000-000000000002'$sql$,
  'workspace deletion proceeds after confirmed private-object removal'
);
select lives_ok(
  $sql$delete from public.organizations where id = '50000000-0000-4000-8000-000000000001'$sql$,
  'organization deletion proceeds after all private-object removals are confirmed'
);

select * from finish();
rollback;
