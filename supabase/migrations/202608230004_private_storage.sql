begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'import-source-files',
  'import-source-files',
  false,
  52428800,
  array[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.can_read_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.imports i
    join public.workspaces w on w.id = i.workspace_id
    join public.memberships m on m.organization_id = w.organization_id
    where w.organization_id::text = split_part(object_name, '/', 1)
      and w.id::text = split_part(object_name, '/', 2)
      and i.id::text = split_part(object_name, '/', 3)
      and split_part(object_name, '/', 4) <> ''
      and i.storage_bucket = 'import-source-files'
      and i.storage_path = object_name
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function app_private.can_create_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.imports i
    join public.workspaces w on w.id = i.workspace_id
    join public.memberships m on m.organization_id = w.organization_id
    where w.organization_id::text = split_part(object_name, '/', 1)
      and w.id::text = split_part(object_name, '/', 2)
      and i.id::text = split_part(object_name, '/', 3)
      and split_part(object_name, '/', 4) <> ''
      and i.storage_bucket = 'import-source-files'
      and i.storage_path = object_name
      and i.created_by = auth.uid()
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'member')
  )
$$;

create or replace function app_private.can_manage_import_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.imports i
    join public.workspaces w on w.id = i.workspace_id
    join public.memberships m on m.organization_id = w.organization_id
    where w.organization_id::text = split_part(object_name, '/', 1)
      and w.id::text = split_part(object_name, '/', 2)
      and i.id::text = split_part(object_name, '/', 3)
      and split_part(object_name, '/', 4) <> ''
      and i.storage_bucket = 'import-source-files'
      and i.storage_path = object_name
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'member')
  )
$$;

revoke all on function app_private.can_read_import_object(text) from public, anon, authenticated;
revoke all on function app_private.can_create_import_object(text) from public, anon, authenticated;
revoke all on function app_private.can_manage_import_object(text) from public, anon, authenticated;
grant execute on function app_private.can_read_import_object(text) to authenticated;
grant execute on function app_private.can_create_import_object(text) to authenticated;
grant execute on function app_private.can_manage_import_object(text) to authenticated;

create policy import_source_files_select_member
on storage.objects for select to authenticated
using (
  bucket_id = 'import-source-files'
  and app_private.can_read_import_object(name)
);

create policy import_source_files_insert_creator
on storage.objects for insert to authenticated
with check (
  bucket_id = 'import-source-files'
  and app_private.can_create_import_object(name)
);

create policy import_source_files_update_editor
on storage.objects for update to authenticated
using (
  bucket_id = 'import-source-files'
  and app_private.can_manage_import_object(name)
)
with check (
  bucket_id = 'import-source-files'
  and app_private.can_manage_import_object(name)
);

create policy import_source_files_delete_editor
on storage.objects for delete to authenticated
using (
  bucket_id = 'import-source-files'
  and app_private.can_manage_import_object(name)
);

commit;
