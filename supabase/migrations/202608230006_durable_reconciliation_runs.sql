begin;

drop index if exists public.imports_file_idempotency_uidx;
create unique index imports_file_mapping_idempotency_uidx on public.imports (
  workspace_id,
  import_type,
  file_sha256,
  (md5(column_mapping::text))
)
where file_sha256 is not null and status <> 'cancelled';

create table public.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_import_id uuid not null,
  payment_import_id uuid not null,
  run_key text not null,
  engine_version text not null,
  status text not null default 'completed',
  snapshot jsonb not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reconciliation_runs_invoice_import_fk foreign key (invoice_import_id, workspace_id)
    references public.imports(id, workspace_id) on delete restrict,
  constraint reconciliation_runs_payment_import_fk foreign key (payment_import_id, workspace_id)
    references public.imports(id, workspace_id) on delete restrict,
  constraint reconciliation_runs_key_check check (run_key ~ '^[A-Za-z0-9:_-]{8,190}$'),
  constraint reconciliation_runs_engine_check check (btrim(engine_version) <> '' and char_length(engine_version) <= 100),
  constraint reconciliation_runs_status_check check (status in ('completed', 'failed')),
  constraint reconciliation_runs_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint reconciliation_runs_snapshot_size_check check (octet_length(snapshot::text) <= 52428800),
  constraint reconciliation_runs_time_check check (completed_at >= started_at),
  unique (id, workspace_id),
  unique (workspace_id, run_key, engine_version)
);

create index reconciliation_runs_workspace_completed_idx
on public.reconciliation_runs (workspace_id, completed_at desc);

alter table public.matches
  add column reconciliation_run_id uuid,
  add column client_match_id text,
  add constraint matches_reconciliation_run_workspace_fk
    foreign key (reconciliation_run_id, workspace_id)
    references public.reconciliation_runs(id, workspace_id) on delete cascade;

create index matches_reconciliation_run_idx
on public.matches (workspace_id, reconciliation_run_id, proposed_at desc)
where reconciliation_run_id is not null;

create unique index matches_run_client_id_uidx
on public.matches (workspace_id, reconciliation_run_id, client_match_id)
where reconciliation_run_id is not null and client_match_id is not null;

alter table public.reconciliation_actions
  add column reconciliation_run_id uuid,
  add constraint reconciliation_actions_run_workspace_fk
    foreign key (reconciliation_run_id, workspace_id)
    references public.reconciliation_runs(id, workspace_id) on delete cascade;

create index reconciliation_actions_run_created_idx
on public.reconciliation_actions (workspace_id, reconciliation_run_id, created_at)
where reconciliation_run_id is not null;

alter table public.matches drop constraint matches_method_check;
alter table public.matches add constraint matches_method_check check (matching_method in (
  'exact_one_to_one', 'invoice_reference', 'combined_invoices', 'combined_payments',
  'partial', 'possible_fee', 'overpayment', 'payer_alias', 'ambiguous',
  'currency_mismatch', 'unmatched', 'duplicate_payment', 'manual'
));

create table public.match_payment_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  match_id uuid not null,
  payment_id uuid not null,
  amount_minor bigint not null,
  sequence_number smallint not null default 1,
  created_at timestamptz not null default now(),
  constraint match_payment_links_match_workspace_fk foreign key (match_id, workspace_id)
    references public.matches(id, workspace_id) on delete cascade,
  constraint match_payment_links_payment_workspace_fk foreign key (payment_id, workspace_id)
    references public.payments(id, workspace_id) on delete restrict,
  constraint match_payment_links_amount_check check (amount_minor > 0),
  constraint match_payment_links_sequence_check check (sequence_number > 0),
  unique (match_id, payment_id)
);

create index match_payment_links_payment_idx
on public.match_payment_links (workspace_id, payment_id, created_at desc);

alter table public.reconciliation_runs enable row level security;
create policy reconciliation_runs_select_workspace on public.reconciliation_runs
for select to authenticated using (app_private.can_access_workspace(workspace_id));

alter table public.match_payment_links enable row level security;
create policy match_payment_links_select_workspace on public.match_payment_links
for select to authenticated using (app_private.can_access_workspace(workspace_id));
create policy match_payment_links_insert_editor on public.match_payment_links
for insert to authenticated with check (app_private.can_edit_workspace(workspace_id));
create policy match_payment_links_update_editor on public.match_payment_links
for update to authenticated using (app_private.can_edit_workspace(workspace_id))
with check (app_private.can_edit_workspace(workspace_id));
create policy match_payment_links_delete_editor on public.match_payment_links
for delete to authenticated using (app_private.can_edit_workspace(workspace_id));

create trigger reconciliation_runs_touch_updated_at before update on public.reconciliation_runs
for each row execute function app_private.touch_updated_at();
create trigger reconciliation_runs_validate_creator before insert or update on public.reconciliation_runs
for each row execute function app_private.validate_authenticated_actor('created_by');
create trigger reconciliation_runs_prevent_creator_reassignment before update on public.reconciliation_runs
for each row execute function app_private.prevent_tenant_reassignment('created_by');
create trigger reconciliation_runs_prevent_workspace_reassignment before update on public.reconciliation_runs
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger match_payment_links_prevent_workspace_reassignment before update on public.match_payment_links
for each row execute function app_private.prevent_tenant_reassignment('workspace_id');
create trigger matches_prevent_run_reassignment before update on public.matches
for each row execute function app_private.prevent_tenant_reassignment('reconciliation_run_id');

revoke all on public.reconciliation_runs, public.match_payment_links from anon, authenticated;
grant select on public.reconciliation_runs to authenticated;
grant select, insert, update, delete on public.match_payment_links to authenticated;

create or replace function public.persist_reconciliation_run(
  p_workspace_id uuid,
  p_run_key text,
  p_engine_version text,
  p_snapshot jsonb,
  p_invoice_import jsonb,
  p_payment_import jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_existing public.reconciliation_runs%rowtype;
  v_run_id uuid;
  v_saved_at timestamptz;
  v_invoice_import_id uuid;
  v_payment_import_id uuid;
  v_invoice_import_is_new boolean := false;
  v_payment_import_is_new boolean := false;
  v_invoice_map jsonb := '{}'::jsonb;
  v_payment_map jsonb := '{}'::jsonb;
  v_item jsonb;
  v_row jsonb;
  v_match jsonb;
  v_evidence jsonb;
  v_reference jsonb;
  v_client_id text;
  v_db_id uuid;
  v_import_row_id uuid;
  v_customer_id uuid;
  v_customer_name text;
  v_normalized_customer_name text;
  v_primary_payment_id uuid;
  v_match_id uuid;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_currency_code text;
  v_method text;
  v_confidence text;
  v_remaining_application bigint;
  v_record_amount bigint;
  v_link_amount bigint;
  v_match_index integer := 0;
  v_sequence integer;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_run_key is null or p_run_key !~ '^[A-Za-z0-9:_-]{8,190}$' then
    raise exception using errcode = '22023', message = 'The reconciliation run key is invalid';
  end if;
  if p_engine_version is null or btrim(p_engine_version) = '' or char_length(p_engine_version) > 100 then
    raise exception using errcode = '22023', message = 'The engine version is invalid';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'invoices') is distinct from 'array'
     or jsonb_typeof(p_snapshot -> 'payments') is distinct from 'array'
     or jsonb_typeof(p_snapshot -> 'result') is distinct from 'object'
     or jsonb_typeof(p_snapshot #> '{result,matches}') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot is invalid';
  end if;
  if p_snapshot ->> 'runId' is distinct from p_run_key
     or jsonb_array_length(p_snapshot -> 'invoices') > 50000
     or jsonb_array_length(p_snapshot -> 'payments') > 50000
     or jsonb_array_length(p_snapshot #> '{result,matches}') > 100000
     or octet_length(p_snapshot::text) > 52428800 then
    raise exception using errcode = '22023', message = 'The reconciliation snapshot exceeds the accepted limits';
  end if;
  if jsonb_typeof(p_invoice_import) is distinct from 'object'
     or jsonb_typeof(p_payment_import) is distinct from 'object'
     or jsonb_typeof(p_invoice_import -> 'rows') is distinct from 'array'
     or jsonb_typeof(p_payment_import -> 'rows') is distinct from 'array'
     or jsonb_typeof(p_invoice_import -> 'columnMapping') is distinct from 'object'
     or jsonb_typeof(p_payment_import -> 'columnMapping') is distinct from 'object'
     or jsonb_typeof(p_invoice_import -> 'sourceHeaders') is distinct from 'array'
     or jsonb_typeof(p_payment_import -> 'sourceHeaders') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The import metadata is invalid';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id;
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_run_key || ':' || p_engine_version, 0)
  );
  select * into v_existing
  from public.reconciliation_runs r
  where r.workspace_id = p_workspace_id
    and r.run_key = p_run_key
    and r.engine_version = p_engine_version;
  if found then
    return jsonb_build_object(
      'run_record_id', v_existing.id,
      'saved_at', v_existing.completed_at,
      'existing', true
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':invoices:' || (p_invoice_import ->> 'sha256') || ':' || md5((p_invoice_import -> 'columnMapping')::text),
    0
  ));
  select i.id into v_invoice_import_id
  from public.imports i
  where i.workspace_id = p_workspace_id
    and i.import_type = 'invoices'
    and i.file_sha256 = p_invoice_import ->> 'sha256'
    and i.column_mapping = p_invoice_import -> 'columnMapping'
    and i.status <> 'cancelled'
  limit 1;
  if v_invoice_import_id is null then
    v_invoice_import_is_new := true;
    insert into public.imports (
      workspace_id, import_type, source_type, status, original_filename,
      content_type, byte_size, file_sha256, sheet_name, column_mapping,
      source_headers, total_rows, accepted_rows, rejected_rows, duplicate_rows,
      blank_rows, started_at, completed_at, created_by
    ) values (
      p_workspace_id, 'invoices', p_invoice_import ->> 'sourceType',
      case when coalesce((p_invoice_import ->> 'rejectedRows')::integer, 0)
                  + coalesce((p_invoice_import ->> 'duplicateRows')::integer, 0) > 0
        then 'completed_with_errors' else 'completed' end,
      p_invoice_import ->> 'originalFilename', p_invoice_import ->> 'contentType',
      (p_invoice_import ->> 'byteSize')::bigint, p_invoice_import ->> 'sha256',
      nullif(p_invoice_import ->> 'sheetName', ''), p_invoice_import -> 'columnMapping',
      p_invoice_import -> 'sourceHeaders', (p_invoice_import ->> 'totalRows')::integer,
      (p_invoice_import ->> 'acceptedRows')::integer, (p_invoice_import ->> 'rejectedRows')::integer,
      (p_invoice_import ->> 'duplicateRows')::integer, (p_invoice_import ->> 'blankRows')::integer,
      now(), now(), v_actor
    ) returning id into v_invoice_import_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || ':payments:' || (p_payment_import ->> 'sha256') || ':' || md5((p_payment_import -> 'columnMapping')::text),
    0
  ));
  select i.id into v_payment_import_id
  from public.imports i
  where i.workspace_id = p_workspace_id
    and i.import_type = 'payments'
    and i.file_sha256 = p_payment_import ->> 'sha256'
    and i.column_mapping = p_payment_import -> 'columnMapping'
    and i.status <> 'cancelled'
  limit 1;
  if v_payment_import_id is null then
    v_payment_import_is_new := true;
    insert into public.imports (
      workspace_id, import_type, source_type, status, original_filename,
      content_type, byte_size, file_sha256, sheet_name, column_mapping,
      source_headers, total_rows, accepted_rows, rejected_rows, duplicate_rows,
      blank_rows, started_at, completed_at, created_by
    ) values (
      p_workspace_id, 'payments', p_payment_import ->> 'sourceType',
      case when coalesce((p_payment_import ->> 'rejectedRows')::integer, 0)
                  + coalesce((p_payment_import ->> 'duplicateRows')::integer, 0) > 0
        then 'completed_with_errors' else 'completed' end,
      p_payment_import ->> 'originalFilename', p_payment_import ->> 'contentType',
      (p_payment_import ->> 'byteSize')::bigint, p_payment_import ->> 'sha256',
      nullif(p_payment_import ->> 'sheetName', ''), p_payment_import -> 'columnMapping',
      p_payment_import -> 'sourceHeaders', (p_payment_import ->> 'totalRows')::integer,
      (p_payment_import ->> 'acceptedRows')::integer, (p_payment_import ->> 'rejectedRows')::integer,
      (p_payment_import ->> 'duplicateRows')::integer, (p_payment_import ->> 'blankRows')::integer,
      now(), now(), v_actor
    ) returning id into v_payment_import_id;
  end if;

  if v_invoice_import_is_new then
    for v_row in select value from jsonb_array_elements(p_invoice_import -> 'rows') loop
      insert into public.import_rows (
        workspace_id, import_id, row_number, record_type, disposition,
        raw_values, normalized_values, issue_codes
      ) values (
        p_workspace_id, v_invoice_import_id, (v_row ->> 'rowNumber')::integer,
        'invoice', v_row ->> 'disposition', v_row -> 'rawValues',
        coalesce(v_row -> 'normalizedValues', '{}'::jsonb),
        coalesce(v_row -> 'issueCodes', '[]'::jsonb)
      );
    end loop;
  end if;

  if v_payment_import_is_new then
    for v_row in select value from jsonb_array_elements(p_payment_import -> 'rows') loop
      insert into public.import_rows (
        workspace_id, import_id, row_number, record_type, disposition,
        raw_values, normalized_values, issue_codes
      ) values (
        p_workspace_id, v_payment_import_id, (v_row ->> 'rowNumber')::integer,
        'payment', v_row ->> 'disposition', v_row -> 'rawValues',
        coalesce(v_row -> 'normalizedValues', '{}'::jsonb),
        coalesce(v_row -> 'issueCodes', '[]'::jsonb)
      );
    end loop;
  end if;

  insert into public.reconciliation_runs (
    workspace_id, invoice_import_id, payment_import_id, run_key,
    engine_version, status, snapshot, created_by, started_at, completed_at
  ) values (
    p_workspace_id, v_invoice_import_id, v_payment_import_id, p_run_key,
    p_engine_version, 'completed', p_snapshot, v_actor, now(), now()
  ) returning id, completed_at into v_run_id, v_saved_at;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'invoices') loop
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null then
      raise exception using errcode = '22023', message = 'An invoice identifier is missing';
    end if;
    v_db_id := null;
    select i.id into v_db_id
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.import_id = v_invoice_import_id
      and i.raw_source ->> 'client_id' = v_client_id
    limit 1;
    if v_db_id is null then
      v_customer_name := btrim(v_item ->> 'customerName');
      v_normalized_customer_name := lower(regexp_replace(v_customer_name, '[^[:alnum:]]+', ' ', 'g'));
      v_customer_id := null;
      if nullif(v_item ->> 'customerId', '') is not null then
        select c.id into v_customer_id from public.customers c
        where c.workspace_id = p_workspace_id and c.external_id = v_item ->> 'customerId'
        limit 1;
      end if;
      if v_customer_id is null then
        select c.id into v_customer_id from public.customers c
        where c.workspace_id = p_workspace_id and c.normalized_name = v_normalized_customer_name
        order by c.created_at
        limit 1;
      end if;
      if v_customer_id is null then
        insert into public.customers (
          workspace_id, external_id, name, normalized_name, email, raw_source
        ) values (
          p_workspace_id, nullif(v_item ->> 'customerId', ''), v_customer_name,
          v_normalized_customer_name, nullif(v_item ->> 'customerEmail', ''),
          jsonb_build_object('reconciliation_run_id', v_run_id)
        ) returning id into v_customer_id;
      end if;

      select r.id into v_import_row_id from public.import_rows r
      where r.workspace_id = p_workspace_id
        and r.import_id = v_invoice_import_id
        and r.row_number = (v_item ->> 'sourceRow')::integer;
      insert into public.invoices (
        workspace_id, customer_id, import_id, import_row_id, invoice_number,
        normalized_invoice_number, invoice_date, due_date, original_amount_minor,
        outstanding_balance_minor, currency_code, status, po_reference, memo, raw_source
      ) values (
        p_workspace_id, v_customer_id, v_invoice_import_id, v_import_row_id,
        v_item ->> 'invoiceNumber',
        coalesce(
          nullif(upper(regexp_replace(v_item ->> 'invoiceNumber', '[^[:alnum:]]', '', 'g')), ''),
          upper(btrim(v_item ->> 'invoiceNumber'))
        ),
        (v_item ->> 'invoiceDate')::date,
        case when nullif(v_item ->> 'dueDate', '') is null then null else (v_item ->> 'dueDate')::date end,
        (v_item ->> 'originalAmountMinor')::bigint,
        (v_item ->> 'outstandingAmountMinor')::bigint,
        upper(v_item ->> 'currency'), v_item ->> 'status',
        coalesce(nullif(v_item ->> 'purchaseOrder', ''), nullif(v_item ->> 'reference', '')),
        nullif(v_item ->> 'memo', ''),
        jsonb_strip_nulls(jsonb_build_object(
          'client_id', v_client_id,
          'customer_name', v_item ->> 'customerName',
          'customer_email', nullif(v_item ->> 'customerEmail', ''),
          'reference', nullif(v_item ->> 'reference', ''),
          'account_id', nullif(v_item ->> 'accountId', ''),
          'reconciliation_run_id', v_run_id
        ))
      ) returning id into v_db_id;
      update public.import_rows set canonical_record_id = v_db_id
      where id = v_import_row_id and workspace_id = p_workspace_id;
    end if;
    v_invoice_map := v_invoice_map || jsonb_build_object(v_client_id, v_db_id::text);
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'payments') loop
    v_client_id := nullif(v_item ->> 'id', '');
    if v_client_id is null then
      raise exception using errcode = '22023', message = 'A payment identifier is missing';
    end if;
    v_db_id := null;
    select p.id into v_db_id
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.import_id = v_payment_import_id
      and p.raw_source ->> 'client_id' = v_client_id
    limit 1;
    if v_db_id is null then
      select r.id into v_import_row_id from public.import_rows r
      where r.workspace_id = p_workspace_id
        and r.import_id = v_payment_import_id
        and r.row_number = (v_item ->> 'sourceRow')::integer;
      insert into public.payments (
        workspace_id, import_id, import_row_id, transaction_date, amount_minor,
        unapplied_amount_minor, currency_code, payer_name, normalized_payer_name,
        description, memo, bank_reference, ach_id, wire_id, account_reference,
        status, raw_source
      ) values (
        p_workspace_id, v_payment_import_id, v_import_row_id,
        (v_item ->> 'paymentDate')::date, (v_item ->> 'amountMinor')::bigint,
        (v_item ->> 'amountMinor')::bigint, upper(v_item ->> 'currency'),
        nullif(v_item ->> 'payerName', ''),
        nullif(lower(regexp_replace(v_item ->> 'payerName', '[^[:alnum:]]+', ' ', 'g')), ''),
        nullif(v_item ->> 'description', ''), nullif(v_item ->> 'memo', ''),
        nullif(v_item ->> 'bankReference', ''), nullif(v_item ->> 'achId', ''),
        nullif(v_item ->> 'wireId', ''), nullif(v_item ->> 'accountId', ''),
        'unmatched',
        jsonb_strip_nulls(jsonb_build_object(
          'client_id', v_client_id,
          'payer_id', nullif(v_item ->> 'payerId', ''),
          'transaction_id', nullif(v_item ->> 'transactionId', ''),
          'reconciliation_run_id', v_run_id
        ))
      ) returning id into v_db_id;
      update public.import_rows set canonical_record_id = v_db_id
      where id = v_import_row_id and workspace_id = p_workspace_id;
    end if;
    v_payment_map := v_payment_map || jsonb_build_object(v_client_id, v_db_id::text);
  end loop;

  for v_match in select value from jsonb_array_elements(p_snapshot #> '{result,matches}') loop
    v_match_index := v_match_index + 1;
    v_client_id := v_match #>> '{paymentIds,0}';
    v_primary_payment_id := nullif(v_payment_map ->> v_client_id, '')::uuid;
    if v_primary_payment_id is null then
      raise exception using errcode = '22023', message = 'A match references an unknown payment';
    end if;
    select p.currency_code into v_currency_code from public.payments p
    where p.id = v_primary_payment_id and p.workspace_id = p_workspace_id;
    v_confidence := case v_match ->> 'confidence'
      when 'high_confidence' then 'high'
      else v_match ->> 'confidence'
    end;
    v_method := case v_match ->> 'method'
      when 'reference_match' then 'invoice_reference'
      when 'grouped_payments' then 'combined_payments'
      when 'partial_payment' then 'partial'
      when 'possible_fee_or_deduction' then 'possible_fee'
      else v_match ->> 'method'
    end;
    insert into public.matches (
      workspace_id, reconciliation_run_id, client_match_id, payment_id, status, confidence_category,
      matching_method, engine_version, idempotency_key, payment_amount_minor,
      proposed_application_minor, discrepancy_minor, currency_code, requires_review
    ) values (
      p_workspace_id, v_run_id, v_match ->> 'id', v_primary_payment_id, 'suggested', v_confidence,
      v_method, p_engine_version, v_run_id::text || ':' || v_match_index::text,
      (v_match ->> 'paymentAmountMinor')::bigint,
      (v_match ->> 'appliedAmountMinor')::bigint,
      (v_match ->> 'discrepancyMinor')::bigint,
      v_currency_code, coalesce((v_match ->> 'requiresConfirmation')::boolean, true)
    ) returning id into v_match_id;

    v_sequence := 0;
    for v_reference in select value from jsonb_array_elements(v_match -> 'paymentIds') loop
      v_sequence := v_sequence + 1;
      v_payment_id := nullif(v_payment_map ->> (v_reference #>> '{}'), '')::uuid;
      if v_payment_id is null then
        raise exception using errcode = '22023', message = 'A match references an unknown payment';
      end if;
      select p.amount_minor into v_record_amount from public.payments p
      where p.id = v_payment_id and p.workspace_id = p_workspace_id;
      insert into public.match_payment_links (
        workspace_id, match_id, payment_id, amount_minor, sequence_number
      ) values (
        p_workspace_id, v_match_id, v_payment_id, v_record_amount, v_sequence
      );
    end loop;

    v_remaining_application := (v_match ->> 'appliedAmountMinor')::bigint;
    v_sequence := 0;
    for v_reference in select value from jsonb_array_elements(v_match -> 'invoiceIds') loop
      exit when v_remaining_application <= 0;
      v_sequence := v_sequence + 1;
      v_invoice_id := nullif(v_invoice_map ->> (v_reference #>> '{}'), '')::uuid;
      if v_invoice_id is null then
        raise exception using errcode = '22023', message = 'A match references an unknown invoice';
      end if;
      select i.outstanding_balance_minor into v_record_amount from public.invoices i
      where i.id = v_invoice_id and i.workspace_id = p_workspace_id;
      v_link_amount := least(v_remaining_application, v_record_amount);
      if v_link_amount > 0 then
        insert into public.match_invoice_links (
          workspace_id, match_id, invoice_id, applied_amount_minor, sequence_number
        ) values (
          p_workspace_id, v_match_id, v_invoice_id, v_link_amount, v_sequence
        );
        v_remaining_application := v_remaining_application - v_link_amount;
      end if;
    end loop;

    v_sequence := 0;
    for v_evidence in select value from jsonb_array_elements(coalesce(v_match -> 'evidence', '[]'::jsonb)) loop
      v_sequence := v_sequence + 1;
      insert into public.match_explanations (
        workspace_id, match_id, reason_code, strength, display_order,
        explanation_text, evidence
      ) values (
        p_workspace_id, v_match_id, v_evidence ->> 'code', v_evidence ->> 'strength',
        v_sequence, v_evidence ->> 'message',
        jsonb_strip_nulls(jsonb_build_object('value', v_evidence -> 'value'))
      );
    end loop;
  end loop;

  update public.payments p set status = case
    when exists (
      select 1 from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and pl.payment_id = p.id
        and m.reconciliation_run_id = v_run_id
        and (m.confidence_category = 'review' or m.matching_method = 'duplicate_payment')
    ) then 'review'
    when exists (
      select 1 from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and pl.payment_id = p.id
        and m.reconciliation_run_id = v_run_id
        and m.confidence_category in ('exact', 'high')
    ) then 'suggested'
    else 'unmatched'
  end
  where p.workspace_id = p_workspace_id
    and p.id in (
      select pl.payment_id from public.match_payment_links pl
      join public.matches m on m.id = pl.match_id and m.workspace_id = pl.workspace_id
      where pl.workspace_id = p_workspace_id and m.reconciliation_run_id = v_run_id
    );

  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values (
    v_organization_id, p_workspace_id, 'payments_processed', current_date, current_date,
    jsonb_array_length(p_snapshot -> 'payments'), 'reconciliation-run:' || v_run_id::text || ':payments'
  );
  insert into public.usage_records (
    organization_id, workspace_id, metric_code, period_start, period_end,
    quantity, source_event_id
  ) values (
    v_organization_id, p_workspace_id, 'imports_completed', current_date, current_date,
    2, 'reconciliation-run:' || v_run_id::text || ':imports'
  );
  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, event_type, entity_type,
    entity_id, source_import_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'reconciliation_run.completed',
    'reconciliation_run', v_run_id, v_invoice_import_id,
    jsonb_build_object(
      'engine_version', p_engine_version,
      'invoice_count', jsonb_array_length(p_snapshot -> 'invoices'),
      'payment_count', jsonb_array_length(p_snapshot -> 'payments'),
      'match_count', jsonb_array_length(p_snapshot #> '{result,matches}'),
      'source_imports', jsonb_build_array(
        jsonb_build_object(
          'id', v_invoice_import_id,
          'type', 'invoices',
          'filename', p_invoice_import ->> 'originalFilename',
          'accepted_rows', (p_invoice_import ->> 'acceptedRows')::integer,
          'rejected_rows', (p_invoice_import ->> 'rejectedRows')::integer
        ),
        jsonb_build_object(
          'id', v_payment_import_id,
          'type', 'payments',
          'filename', p_payment_import ->> 'originalFilename',
          'accepted_rows', (p_payment_import ->> 'acceptedRows')::integer,
          'rejected_rows', (p_payment_import ->> 'rejectedRows')::integer
        )
      )
    )
  );

  return jsonb_build_object(
    'run_record_id', v_run_id,
    'saved_at', v_saved_at,
    'existing', false
  );
end;
$$;

create or replace function public.record_reconciliation_decision(
  p_workspace_id uuid,
  p_run_record_id uuid,
  p_client_match_id text,
  p_outcome text,
  p_invoice_client_ids text[],
  p_note text,
  p_fee_minor bigint,
  p_feedback text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_run public.reconciliation_runs%rowtype;
  v_match public.matches%rowtype;
  v_existing_action public.reconciliation_actions%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_invoice_id uuid;
  v_selected_invoice_ids uuid[] := '{}'::uuid[];
  v_client_invoice_id text;
  v_total_invoice_balance bigint := 0;
  v_total_payment_available bigint := 0;
  v_target_application bigint := 0;
  v_remaining_application bigint := 0;
  v_allocation bigint := 0;
  v_sequence integer := 0;
  v_invoice_balances jsonb := '{}'::jsonb;
  v_source_imports jsonb := '[]'::jsonb;
  v_payment_links jsonb := '[]'::jsonb;
  v_proposed_invoice_links jsonb := '[]'::jsonb;
  v_match_evidence jsonb := '[]'::jsonb;
  v_invoice_applications jsonb := '[]'::jsonb;
  v_payment_applications jsonb := '[]'::jsonb;
  v_previous_state jsonb;
  v_new_state jsonb;
  v_decision jsonb;
  v_action_type text;
  v_action_id uuid;
  v_decided_at timestamptz := now();
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_outcome is null
     or p_outcome not in ('confirmed', 'rejected', 'unmatched')
     or nullif(btrim(p_client_match_id), '') is null
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 200
     or char_length(coalesce(p_note, '')) > 2000
     or coalesce(p_fee_minor, 0) < 0
     or (p_feedback is not null and p_feedback not in ('correct', 'incorrect'))
     or coalesce(cardinality(p_invoice_client_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'The reconciliation decision is invalid';
  end if;
  if p_outcome = 'confirmed' and coalesce(cardinality(p_invoice_client_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'A confirmed decision requires at least one invoice';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id;
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  select a.* into v_existing_action
  from public.reconciliation_actions a
  where a.workspace_id = p_workspace_id
    and a.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'action_id', v_existing_action.id,
      'decision', v_existing_action.new_state -> 'decision',
      'invoice_balances', coalesce(v_existing_action.new_state -> 'invoiceBalances', '{}'::jsonb),
      'existing', true
    );
  end if;

  select r.* into v_run
  from public.reconciliation_runs r
  where r.id = p_run_record_id
    and r.workspace_id = p_workspace_id
    and r.status = 'completed';
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation run is not available in this workspace';
  end if;

  select m.* into v_match
  from public.matches m
  where m.workspace_id = p_workspace_id
    and m.reconciliation_run_id = p_run_record_id
    and m.client_match_id = p_client_match_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation match is not available in this run';
  end if;
  if v_match.status <> 'suggested' then
    raise exception using errcode = '55000', message = 'This reconciliation match already has a decision';
  end if;

  perform 1
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
  order by pl.sequence_number
  for update of p;

  select coalesce(sum(p.unapplied_amount_minor), 0) into v_total_payment_available
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select jsonb_build_array(
    jsonb_build_object(
      'id', ii.id,
      'type', ii.import_type,
      'filename', ii.original_filename,
      'accepted_rows', ii.accepted_rows,
      'rejected_rows', ii.rejected_rows
    ),
    jsonb_build_object(
      'id', pi.id,
      'type', pi.import_type,
      'filename', pi.original_filename,
      'accepted_rows', pi.accepted_rows,
      'rejected_rows', pi.rejected_rows
    )
  ) into v_source_imports
  from public.imports ii
  cross join public.imports pi
  where ii.id = v_run.invoice_import_id and ii.workspace_id = p_workspace_id
    and pi.id = v_run.payment_import_id and pi.workspace_id = p_workspace_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'paymentId', coalesce(nullif(p.raw_source ->> 'client_id', ''), p.id::text),
    'recordId', p.id,
    'amountMinor', p.amount_minor,
    'unappliedAmountMinorBefore', p.unapplied_amount_minor,
    'currency', p.currency_code,
    'transactionId', nullif(p.raw_source ->> 'transaction_id', ''),
    'bankReference', p.bank_reference,
    'sourceImportId', p.import_id
  )) order by pl.sequence_number), '[]'::jsonb)
  into v_payment_links
  from public.match_payment_links pl
  join public.payments p on p.id = pl.payment_id and p.workspace_id = pl.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invoiceId', coalesce(nullif(i.raw_source ->> 'client_id', ''), i.id::text),
    'recordId', i.id,
    'invoiceNumber', i.invoice_number,
    'proposedAmountMinor', l.applied_amount_minor,
    'outstandingAmountMinorBefore', i.outstanding_balance_minor
  ) order by l.sequence_number), '[]'::jsonb)
  into v_proposed_invoice_links
  from public.match_invoice_links l
  join public.invoices i on i.id = l.invoice_id and i.workspace_id = l.workspace_id
  where l.workspace_id = p_workspace_id and l.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', e.reason_code,
    'strength', e.strength,
    'message', e.explanation_text,
    'evidence', e.evidence
  ) order by e.display_order), '[]'::jsonb)
  into v_match_evidence
  from public.match_explanations e
  where e.workspace_id = p_workspace_id and e.match_id = v_match.id;

  v_previous_state := jsonb_build_object(
    'matchStatus', v_match.status,
    'matchingMethod', v_match.matching_method,
    'confidence', v_match.confidence_category,
    'proposedApplicationMinor', v_match.proposed_application_minor,
    'discrepancyMinor', v_match.discrepancy_minor,
    'paymentLinks', v_payment_links,
    'invoiceLinks', v_proposed_invoice_links,
    'evidence', v_match_evidence
  );

  if p_outcome = 'confirmed' then
    foreach v_client_invoice_id in array p_invoice_client_ids loop
      select i.* into v_invoice
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.import_id = v_run.invoice_import_id
        and i.raw_source ->> 'client_id' = v_client_invoice_id
        and i.status in ('open', 'partially_paid')
        and i.currency_code = v_match.currency_code
      for update;
      if not found then
        raise exception using errcode = '22023', message = 'A selected invoice is unavailable, paid, or uses another currency';
      end if;
      if v_invoice.id = any(v_selected_invoice_ids) then
        raise exception using errcode = '22023', message = 'A selected invoice was provided more than once';
      end if;
      v_selected_invoice_ids := array_append(v_selected_invoice_ids, v_invoice.id);
      v_total_invoice_balance := v_total_invoice_balance + v_invoice.outstanding_balance_minor;
    end loop;

    v_target_application := least(
      case when v_match.proposed_application_minor > 0
        then v_match.proposed_application_minor else v_match.payment_amount_minor end,
      v_total_payment_available,
      v_total_invoice_balance
    );
    if v_target_application <= 0 then
      raise exception using errcode = '55000', message = 'No unapplied payment amount or open invoice balance remains';
    end if;
    if coalesce(p_fee_minor, 0) > v_match.payment_amount_minor then
      raise exception using errcode = '22023', message = 'The fee cannot exceed the payment amount';
    end if;

    delete from public.match_invoice_links l
    where l.workspace_id = p_workspace_id and l.match_id = v_match.id;
    v_remaining_application := v_target_application;
    v_sequence := 0;
    foreach v_invoice_id in array v_selected_invoice_ids loop
      exit when v_remaining_application <= 0;
      v_sequence := v_sequence + 1;
      select i.* into v_invoice from public.invoices i
      where i.workspace_id = p_workspace_id and i.id = v_invoice_id
      for update;
      v_allocation := least(v_remaining_application, v_invoice.outstanding_balance_minor);
      if v_allocation > 0 then
        update public.invoices i set
          outstanding_balance_minor = i.outstanding_balance_minor - v_allocation,
          status = case
            when i.outstanding_balance_minor - v_allocation = 0 then 'paid'
            when i.outstanding_balance_minor - v_allocation < i.original_amount_minor then 'partially_paid'
            else 'open'
          end
        where i.id = v_invoice_id and i.workspace_id = p_workspace_id
        returning * into v_invoice;
        insert into public.match_invoice_links (
          workspace_id, match_id, invoice_id, applied_amount_minor, sequence_number
        ) values (
          p_workspace_id, v_match.id, v_invoice_id, v_allocation, v_sequence
        );
        v_invoice_balances := v_invoice_balances || jsonb_build_object(
          v_invoice.raw_source ->> 'client_id', v_invoice.outstanding_balance_minor
        );
        v_invoice_applications := v_invoice_applications || jsonb_build_array(jsonb_build_object(
          'invoiceId', v_invoice.raw_source ->> 'client_id',
          'recordId', v_invoice.id,
          'invoiceNumber', v_invoice.invoice_number,
          'appliedAmountMinor', v_allocation,
          'resultingOutstandingAmountMinor', v_invoice.outstanding_balance_minor
        ));
        v_remaining_application := v_remaining_application - v_allocation;
      end if;
    end loop;

    v_remaining_application := v_target_application;
    for v_payment in
      select p.*
      from public.payments p
      join public.match_payment_links pl
        on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
      where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      order by pl.sequence_number
      for update of p
    loop
      exit when v_remaining_application <= 0;
      v_allocation := least(v_remaining_application, v_payment.unapplied_amount_minor);
      update public.payments p set
        unapplied_amount_minor = p.unapplied_amount_minor - v_allocation,
        status = case
          when p.unapplied_amount_minor - v_allocation = 0 then 'reconciled'
          when p.unapplied_amount_minor - v_allocation < p.amount_minor then 'partially_applied'
          else 'unmatched'
      end
      where p.id = v_payment.id and p.workspace_id = p_workspace_id
      returning p.* into v_payment;
      v_payment_applications := v_payment_applications || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'paymentId', coalesce(nullif(v_payment.raw_source ->> 'client_id', ''), v_payment.id::text),
        'recordId', v_payment.id,
        'appliedAmountMinor', v_allocation,
        'resultingUnappliedAmountMinor', v_payment.unapplied_amount_minor,
        'sourceImportId', v_payment.import_id
      )));
      v_remaining_application := v_remaining_application - v_allocation;
    end loop;

    update public.matches m set
      status = 'approved', proposed_application_minor = v_target_application,
      requires_review = false, resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    v_action_type := 'approve';
  else
    update public.matches m set
      status = 'rejected', resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    update public.payments p set status = case
      when p.unapplied_amount_minor = 0 then 'reconciled'
      when p.unapplied_amount_minor < p.amount_minor then 'partially_applied'
      else 'unmatched'
    end
    where p.workspace_id = p_workspace_id
      and p.id in (
        select pl.payment_id from public.match_payment_links pl
        where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      );
    v_action_type := case when p_outcome = 'rejected' then 'reject' else 'leave_unmatched' end;
  end if;

  v_decision := jsonb_strip_nulls(jsonb_build_object(
    'matchId', p_client_match_id,
    'outcome', p_outcome,
    'invoiceIds', case when p_outcome = 'confirmed' then to_jsonb(p_invoice_client_ids) else '[]'::jsonb end,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'feeMinor', case when coalesce(p_fee_minor, 0) > 0 then p_fee_minor else null end,
    'appliedAmountMinor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
    'feedback', p_feedback,
    'decidedAt', v_decided_at
  ));
  v_new_state := jsonb_build_object(
    'decision', v_decision,
    'invoiceBalances', v_invoice_balances,
    'appliedAmountMinor', v_target_application,
    'invoiceApplications', v_invoice_applications,
    'paymentApplications', v_payment_applications,
    'paymentLinks', v_payment_links,
    'sourceImports', v_source_imports,
    'automatedProposal', jsonb_build_object(
      'matchingMethod', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'proposedApplicationMinor', v_match.proposed_application_minor,
      'discrepancyMinor', v_match.discrepancy_minor,
      'invoiceLinks', v_proposed_invoice_links,
      'evidence', v_match_evidence
    )
  );

  insert into public.reconciliation_actions (
    workspace_id, reconciliation_run_id, match_id, payment_id, actor_user_id, action_type,
    decision_note, previous_state, new_state, idempotency_key
  ) values (
    p_workspace_id, p_run_record_id, v_match.id, v_match.payment_id, v_actor, v_action_type,
    nullif(btrim(coalesce(p_note, '')), ''), v_previous_state, v_new_state,
    p_idempotency_key
  ) returning id into v_action_id;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, event_type, entity_type,
    entity_id, source_import_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor,
    'reconciliation_match.' || p_outcome, 'match', v_match.id, v_run.payment_import_id,
    jsonb_build_object(
      'action_id', v_action_id,
      'reconciliation_run_id', p_run_record_id,
      'client_match_id', p_client_match_id,
      'invoice_count', case when p_outcome = 'confirmed' then cardinality(p_invoice_client_ids) else 0 end,
      'invoice_ids', case when p_outcome = 'confirmed' then to_jsonb(p_invoice_client_ids) else '[]'::jsonb end,
      'applied_amount_minor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
      'currency_code', v_match.currency_code,
      'matching_method', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'payment_links', v_payment_links,
      'proposed_invoice_links', v_proposed_invoice_links,
      'match_evidence', v_match_evidence,
      'source_imports', v_source_imports,
      'has_note', nullif(btrim(coalesce(p_note, '')), '') is not null,
      'feedback', p_feedback
    )
  );

  if p_outcome = 'confirmed' then
    insert into public.usage_records (
      organization_id, workspace_id, metric_code, period_start, period_end,
      quantity, source_event_id
    ) values (
      v_organization_id, p_workspace_id, 'matches_confirmed', current_date, current_date,
      1, 'reconciliation-action:' || v_action_id::text
    );
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'decision', v_decision,
    'invoice_balances', v_invoice_balances,
    'existing', false
  );
end;
$$;

create or replace function public.record_reconciliation_export(
  p_workspace_id uuid,
  p_run_record_id uuid,
  p_export_type text,
  p_file_type text,
  p_row_count integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_event_id bigint;
  v_created_at timestamptz;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_access_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;
  if p_export_type is null
     or p_export_type not in ('reconciled', 'unmatched', 'discrepancy', 'audit')
     or p_file_type is null
     or p_file_type not in ('csv', 'xlsx')
     or p_row_count is null
     or p_row_count < 0
     or p_row_count > 100000
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'The reconciliation export is invalid';
  end if;
  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id;
  if v_organization_id is null or not exists (
    select 1 from public.reconciliation_runs r
    where r.id = p_run_record_id and r.workspace_id = p_workspace_id and r.status = 'completed'
  ) then
    raise exception using errcode = '42501', message = 'The reconciliation run is not available in this workspace';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':export:' || p_idempotency_key, 0)
  );
  select e.id, e.created_at into v_event_id, v_created_at
  from public.audit_events e
  where e.workspace_id = p_workspace_id
    and e.event_type = 'reconciliation_export.created'
    and e.metadata ->> 'idempotency_key' = p_idempotency_key
  limit 1;
  if found then
    return jsonb_build_object('event_id', v_event_id, 'created_at', v_created_at, 'existing', true);
  end if;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, event_type, entity_type,
    entity_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor, 'reconciliation_export.created',
    'reconciliation_run', p_run_record_id,
    jsonb_build_object(
      'reconciliation_run_id', p_run_record_id,
      'export_type', p_export_type,
      'file_type', p_file_type,
      'row_count', p_row_count,
      'idempotency_key', p_idempotency_key
    )
  ) returning id, created_at into v_event_id, v_created_at;

  return jsonb_build_object('event_id', v_event_id, 'created_at', v_created_at, 'existing', false);
end;
$$;

create or replace function public.get_workspace_audit_events(
  p_workspace_id uuid,
  p_before_id bigint default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_events jsonb;
  v_oldest_id bigint;
  v_has_more boolean := false;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_access_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;
  if p_before_id is not null and p_before_id <= 0 then
    raise exception using errcode = '22023', message = 'The audit cursor is invalid';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'The audit page size is invalid';
  end if;

  with selected as (
    select
      e.id,
      e.event_type,
      e.actor_user_id,
      e.actor_type,
      e.entity_type,
      e.entity_id,
      e.request_id,
      e.source_import_id,
      e.metadata,
      e.created_at,
      p.display_name as actor_display_name,
      p.email as actor_email,
      i.import_type as source_import_type,
      i.original_filename as source_import_filename,
      a.id as action_id,
      a.action_type,
      a.decision_note,
      a.previous_state,
      a.new_state
    from public.audit_events e
    left join public.profiles p on p.id = e.actor_user_id
    left join public.imports i
      on i.id = e.source_import_id and i.workspace_id = e.workspace_id
    left join public.reconciliation_actions a
      on a.workspace_id = e.workspace_id
      and a.id = case
        when coalesce(e.metadata ->> 'action_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (e.metadata ->> 'action_id')::uuid
        else null
      end
    where e.workspace_id = p_workspace_id
      and (p_before_id is null or e.id < p_before_id)
    order by e.id desc
    limit p_limit
  )
  select
    coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', s.id::text,
        'eventType', s.event_type,
        'actor', jsonb_strip_nulls(jsonb_build_object(
          'id', s.actor_user_id,
          'type', s.actor_type,
          'name', case
            when s.actor_type = 'user' then coalesce(nullif(btrim(s.actor_display_name), ''), s.actor_email, 'Former workspace member')
            when s.actor_type = 'integration' then 'Connected integration'
            when s.actor_type = 'support' then 'Authorized support'
            else 'InvoiceReconcile system'
          end
        )),
        'entity', case when s.entity_type is null then null else jsonb_strip_nulls(jsonb_build_object(
          'type', s.entity_type,
          'id', s.entity_id
        )) end,
        'requestId', s.request_id,
        'sourceImport', case when s.source_import_id is null then null else jsonb_strip_nulls(jsonb_build_object(
          'id', s.source_import_id,
          'type', s.source_import_type,
          'filename', s.source_import_filename
        )) end,
        'metadata', s.metadata,
        'action', case when s.action_id is null then null else jsonb_strip_nulls(jsonb_build_object(
          'id', s.action_id,
          'type', s.action_type,
          'note', s.decision_note,
          'previousState', s.previous_state,
          'newState', s.new_state
        )) end,
        'createdAt', s.created_at
      )) order by s.id desc
    ), '[]'::jsonb),
    min(s.id)
  into v_events, v_oldest_id
  from selected s;

  if v_oldest_id is not null then
    select exists (
      select 1 from public.audit_events e
      where e.workspace_id = p_workspace_id and e.id < v_oldest_id
    ) into v_has_more;
  end if;

  return jsonb_build_object(
    'events', v_events,
    'next_cursor', case when v_has_more then v_oldest_id::text else null end
  );
end;
$$;

create or replace function public.get_latest_reconciliation_run(
  p_workspace_id uuid
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
  v_decisions jsonb := '{}'::jsonb;
  v_invoice_states jsonb := '{}'::jsonb;
begin
  if v_actor is null or auth.role() <> 'authenticated' then
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
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select coalesce(jsonb_object_agg(
    a.new_state #>> '{decision,matchId}',
    a.new_state -> 'decision'
    order by a.created_at
  ), '{}'::jsonb)
  into v_decisions
  from public.reconciliation_actions a
  where a.workspace_id = p_workspace_id
    and a.reconciliation_run_id = v_run.id
    and jsonb_typeof(a.new_state -> 'decision') = 'object'
    and nullif(a.new_state #>> '{decision,matchId}', '') is not null;

  select coalesce(jsonb_object_agg(
    i.raw_source ->> 'client_id',
    jsonb_build_object(
      'outstandingAmountMinor', i.outstanding_balance_minor,
      'status', i.status
    )
  ), '{}'::jsonb)
  into v_invoice_states
  from public.invoices i
  where i.workspace_id = p_workspace_id
    and i.import_id = v_run.invoice_import_id
    and nullif(i.raw_source ->> 'client_id', '') is not null;

  return jsonb_build_object(
    'status', 'ready',
    'run_record_id', v_run.id,
    'run_key', v_run.run_key,
    'snapshot', v_run.snapshot,
    'completed_at', v_run.completed_at,
    'decisions', v_decisions,
    'invoice_states', v_invoice_states
  );
end;
$$;

revoke all on function public.persist_reconciliation_run(uuid, text, text, jsonb, jsonb, jsonb)
from public, anon;
grant execute on function public.persist_reconciliation_run(uuid, text, text, jsonb, jsonb, jsonb)
to authenticated;
revoke all on function public.record_reconciliation_decision(uuid, uuid, text, text, text[], text, bigint, text, text)
from public, anon;
grant execute on function public.record_reconciliation_decision(uuid, uuid, text, text, text[], text, bigint, text, text)
to authenticated;
revoke all on function public.record_reconciliation_export(uuid, uuid, text, text, integer, text)
from public, anon;
grant execute on function public.record_reconciliation_export(uuid, uuid, text, text, integer, text)
to authenticated;
revoke all on function public.get_workspace_audit_events(uuid, bigint, integer)
from public, anon;
grant execute on function public.get_workspace_audit_events(uuid, bigint, integer)
to authenticated;
revoke all on function public.get_latest_reconciliation_run(uuid)
from public, anon;
grant execute on function public.get_latest_reconciliation_run(uuid)
to authenticated;

commit;
