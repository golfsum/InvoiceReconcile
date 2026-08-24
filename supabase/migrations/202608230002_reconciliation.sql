begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_id text,
  name text not null,
  normalized_name text not null,
  email text,
  status text not null default 'active',
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (btrim(name) <> '' and btrim(normalized_name) <> ''),
  constraint customers_status_check check (status in ('active', 'inactive', 'merged')),
  constraint customers_raw_object check (jsonb_typeof(raw_source) = 'object'),
  unique (id, workspace_id)
);

create unique index customers_workspace_external_uidx on public.customers (workspace_id, external_id) where external_id is not null;
create index customers_workspace_name_idx on public.customers (workspace_id, normalized_name);

create table public.payer_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  alias text not null,
  normalized_alias text not null,
  source_pattern text,
  match_type text not null default 'exact_normalized',
  is_active boolean not null default true,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payer_aliases_customer_workspace_fk foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade,
  constraint payer_aliases_not_blank check (btrim(alias) <> '' and btrim(normalized_alias) <> ''),
  constraint payer_aliases_match_type_check check (match_type in ('exact_normalized', 'contains', 'regex')),
  unique (id, workspace_id)
);

create unique index payer_aliases_active_value_uidx on public.payer_aliases (workspace_id, normalized_alias, customer_id) where is_active;
create index payer_aliases_customer_idx on public.payer_aliases (workspace_id, customer_id);

create table public.payment_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null,
  name text not null,
  external_account_id text,
  currency_code text,
  last_four text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_sources_type_check check (source_type in ('csv', 'xlsx', 'bank_statement', 'processor', 'accounting_integration', 'bank_integration', 'sample')),
  constraint payment_sources_currency_check check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint payment_sources_last_four_check check (last_four is null or last_four ~ '^[A-Za-z0-9]{2,8}$'),
  constraint payment_sources_metadata_object check (jsonb_typeof(metadata) = 'object'),
  unique (id, workspace_id)
);

create index payment_sources_workspace_idx on public.payment_sources (workspace_id, is_active);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_type text not null,
  source_type text not null,
  payment_source_id uuid,
  status text not null default 'uploaded',
  original_filename text,
  storage_bucket text,
  storage_path text,
  content_type text,
  byte_size bigint,
  file_sha256 text,
  sheet_name text,
  column_mapping jsonb not null default '{}'::jsonb,
  source_headers jsonb not null default '[]'::jsonb,
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  blank_rows integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint imports_payment_source_workspace_fk foreign key (payment_source_id, workspace_id)
    references public.payment_sources(id, workspace_id) on delete set null (payment_source_id),
  constraint imports_type_check check (import_type in ('invoices', 'payments')),
  constraint imports_source_check check (source_type in ('csv', 'xlsx', 'pdf', 'bank_statement', 'integration', 'sample')),
  constraint imports_status_check check (status in ('uploaded', 'mapping', 'queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  constraint imports_storage_pair check ((storage_bucket is null) = (storage_path is null)),
  constraint imports_content_type_check check (content_type is null or content_type in (
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  )),
  constraint imports_byte_size_check check (byte_size is null or byte_size between 1 and 52428800),
  constraint imports_sha256_check check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint imports_mapping_object check (jsonb_typeof(column_mapping) = 'object'),
  constraint imports_headers_array check (jsonb_typeof(source_headers) = 'array'),
  constraint imports_row_counts_check check (
    total_rows >= 0 and accepted_rows >= 0 and rejected_rows >= 0 and duplicate_rows >= 0 and blank_rows >= 0
    and accepted_rows + rejected_rows + duplicate_rows + blank_rows <= total_rows
  ),
  unique (id, workspace_id)
);

create unique index imports_file_idempotency_uidx on public.imports (workspace_id, import_type, file_sha256)
where file_sha256 is not null and status <> 'cancelled';
create index imports_workspace_created_idx on public.imports (workspace_id, created_at desc);
create index imports_workspace_status_idx on public.imports (workspace_id, status, created_at);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_id uuid not null,
  row_number integer not null,
  record_type text not null,
  disposition text not null default 'pending',
  raw_values jsonb not null,
  normalized_values jsonb not null default '{}'::jsonb,
  issue_codes jsonb not null default '[]'::jsonb,
  dedupe_hash text,
  canonical_record_id uuid,
  created_at timestamptz not null default now(),
  constraint import_rows_import_workspace_fk foreign key (import_id, workspace_id)
    references public.imports(id, workspace_id) on delete cascade,
  constraint import_rows_number_check check (row_number > 0),
  constraint import_rows_record_type_check check (record_type in ('invoice', 'payment')),
  constraint import_rows_disposition_check check (disposition in ('pending', 'accepted', 'rejected', 'duplicate', 'blank')),
  constraint import_rows_raw_object check (jsonb_typeof(raw_values) = 'object'),
  constraint import_rows_normalized_object check (jsonb_typeof(normalized_values) = 'object'),
  constraint import_rows_issues_array check (jsonb_typeof(issue_codes) = 'array'),
  constraint import_rows_dedupe_hash_check check (dedupe_hash is null or dedupe_hash ~ '^[0-9a-f]{64}$'),
  unique (id, workspace_id),
  unique (import_id, row_number)
);

create index import_rows_import_disposition_idx on public.import_rows (import_id, disposition, row_number);
create index import_rows_workspace_dedupe_idx on public.import_rows (workspace_id, record_type, dedupe_hash) where dedupe_hash is not null;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid,
  import_id uuid,
  import_row_id uuid,
  external_id text,
  invoice_number text not null,
  normalized_invoice_number text not null,
  invoice_date date not null,
  due_date date,
  original_amount_minor bigint not null,
  outstanding_balance_minor bigint not null,
  currency_code text not null,
  status text not null default 'open',
  po_reference text,
  memo text,
  dedupe_key text,
  duplicate_of_id uuid,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_customer_workspace_fk foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete set null (customer_id),
  constraint invoices_import_workspace_fk foreign key (import_id, workspace_id)
    references public.imports(id, workspace_id) on delete set null (import_id),
  constraint invoices_import_row_workspace_fk foreign key (import_row_id, workspace_id)
    references public.import_rows(id, workspace_id) on delete set null (import_row_id),
  constraint invoices_duplicate_workspace_fk foreign key (duplicate_of_id, workspace_id)
    references public.invoices(id, workspace_id) on delete set null (duplicate_of_id),
  constraint invoices_number_not_blank check (btrim(invoice_number) <> '' and btrim(normalized_invoice_number) <> ''),
  constraint invoices_due_date_check check (due_date is null or due_date >= invoice_date),
  constraint invoices_amounts_check check (original_amount_minor > 0 and outstanding_balance_minor between 0 and original_amount_minor),
  constraint invoices_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint invoices_status_check check (status in ('open', 'partially_paid', 'paid', 'void', 'duplicate')),
  constraint invoices_raw_object check (jsonb_typeof(raw_source) = 'object'),
  constraint invoices_duplicate_state_check check ((status = 'duplicate') = (duplicate_of_id is not null)),
  unique (id, workspace_id)
);

create unique index invoices_workspace_external_uidx on public.invoices (workspace_id, external_id) where external_id is not null and duplicate_of_id is null;
create unique index invoices_workspace_dedupe_uidx on public.invoices (workspace_id, dedupe_key) where dedupe_key is not null and duplicate_of_id is null;
create index invoices_open_match_idx on public.invoices (workspace_id, currency_code, outstanding_balance_minor, invoice_date) where status in ('open', 'partially_paid');
create index invoices_customer_open_idx on public.invoices (workspace_id, customer_id, invoice_date) where status in ('open', 'partially_paid');
create index invoices_reference_idx on public.invoices (workspace_id, normalized_invoice_number);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid,
  payment_source_id uuid,
  import_id uuid,
  import_row_id uuid,
  external_id text,
  transaction_date date not null,
  amount_minor bigint not null,
  unapplied_amount_minor bigint not null,
  currency_code text not null,
  payer_name text,
  normalized_payer_name text,
  description text,
  memo text,
  bank_reference text,
  ach_id text,
  wire_id text,
  account_reference text,
  status text not null default 'unmatched',
  dedupe_key text,
  duplicate_of_id uuid,
  raw_source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_customer_workspace_fk foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete set null (customer_id),
  constraint payments_source_workspace_fk foreign key (payment_source_id, workspace_id)
    references public.payment_sources(id, workspace_id) on delete set null (payment_source_id),
  constraint payments_import_workspace_fk foreign key (import_id, workspace_id)
    references public.imports(id, workspace_id) on delete set null (import_id),
  constraint payments_import_row_workspace_fk foreign key (import_row_id, workspace_id)
    references public.import_rows(id, workspace_id) on delete set null (import_row_id),
  constraint payments_duplicate_workspace_fk foreign key (duplicate_of_id, workspace_id)
    references public.payments(id, workspace_id) on delete set null (duplicate_of_id),
  constraint payments_amount_check check (amount_minor > 0 and unapplied_amount_minor between 0 and amount_minor),
  constraint payments_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payments_status_check check (status in ('unmatched', 'suggested', 'review', 'partially_applied', 'reconciled', 'duplicate', 'ignored')),
  constraint payments_raw_object check (jsonb_typeof(raw_source) = 'object'),
  constraint payments_duplicate_state_check check ((status = 'duplicate') = (duplicate_of_id is not null)),
  unique (id, workspace_id)
);

create unique index payments_workspace_external_uidx on public.payments (workspace_id, external_id) where external_id is not null and duplicate_of_id is null;
create unique index payments_workspace_dedupe_uidx on public.payments (workspace_id, dedupe_key) where dedupe_key is not null and duplicate_of_id is null;
create index payments_match_candidates_idx on public.payments (workspace_id, currency_code, amount_minor, transaction_date) where status in ('unmatched', 'suggested', 'review');
create index payments_queue_idx on public.payments (workspace_id, status, transaction_date desc);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payment_id uuid not null,
  status text not null default 'suggested',
  confidence_category text not null,
  matching_method text not null,
  engine_version text not null,
  idempotency_key text not null,
  payment_amount_minor bigint not null,
  proposed_application_minor bigint not null,
  discrepancy_minor bigint not null default 0,
  currency_code text not null,
  candidate_rank smallint,
  requires_review boolean not null default true,
  proposed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_payment_workspace_fk foreign key (payment_id, workspace_id)
    references public.payments(id, workspace_id) on delete cascade,
  constraint matches_status_check check (status in ('suggested', 'approved', 'rejected', 'superseded', 'cancelled')),
  constraint matches_confidence_check check (confidence_category in ('exact', 'high', 'review', 'unmatched')),
  constraint matches_method_check check (matching_method in ('exact_one_to_one', 'invoice_reference', 'combined_invoices', 'combined_payments', 'partial', 'possible_fee', 'overpayment', 'payer_alias', 'ambiguous', 'currency_mismatch', 'unmatched', 'manual')),
  constraint matches_amount_check check (
    payment_amount_minor > 0
    and proposed_application_minor between 0 and payment_amount_minor
  ),
  constraint matches_currency_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint matches_rank_check check (candidate_rank is null or candidate_rank > 0),
  constraint matches_resolution_check check (
    (status in ('approved', 'rejected', 'superseded', 'cancelled')) = (resolved_at is not null)
  ),
  unique (id, workspace_id),
  unique (workspace_id, idempotency_key)
);

create index matches_review_queue_idx on public.matches (workspace_id, status, confidence_category, proposed_at desc);
create index matches_payment_idx on public.matches (workspace_id, payment_id, proposed_at desc);

create table public.match_invoice_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  match_id uuid not null,
  invoice_id uuid not null,
  applied_amount_minor bigint not null,
  sequence_number smallint not null default 1,
  created_at timestamptz not null default now(),
  constraint match_invoice_links_match_workspace_fk foreign key (match_id, workspace_id)
    references public.matches(id, workspace_id) on delete cascade,
  constraint match_invoice_links_invoice_workspace_fk foreign key (invoice_id, workspace_id)
    references public.invoices(id, workspace_id) on delete restrict,
  constraint match_invoice_links_amount_check check (applied_amount_minor > 0),
  constraint match_invoice_links_sequence_check check (sequence_number > 0),
  unique (match_id, invoice_id)
);

create index match_invoice_links_invoice_idx on public.match_invoice_links (workspace_id, invoice_id);

create table public.match_explanations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  match_id uuid not null,
  reason_code text not null,
  strength text not null,
  display_order smallint not null default 1,
  explanation_text text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint match_explanations_match_workspace_fk foreign key (match_id, workspace_id)
    references public.matches(id, workspace_id) on delete cascade,
  constraint match_explanations_strength_check check (strength in ('strong', 'supporting', 'warning', 'blocking')),
  constraint match_explanations_order_check check (display_order > 0),
  constraint match_explanations_text_check check (btrim(explanation_text) <> ''),
  constraint match_explanations_evidence_object check (jsonb_typeof(evidence) = 'object'),
  unique (match_id, reason_code, display_order)
);

create table public.matching_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  rule_type text not null,
  source_pattern text,
  customer_id uuid,
  action_type text not null,
  configuration jsonb not null default '{}'::jsonb,
  priority smallint not null default 100,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_rules_customer_workspace_fk foreign key (customer_id, workspace_id)
    references public.customers(id, workspace_id) on delete cascade,
  constraint matching_rules_name_not_blank check (btrim(name) <> ''),
  constraint matching_rules_type_check check (rule_type in ('payer_mapping', 'reference_pattern', 'description_pattern', 'fee_behavior')),
  constraint matching_rules_action_check check (action_type in ('map_customer', 'extract_reference', 'flag_possible_fee', 'require_review')),
  constraint matching_rules_priority_check check (priority between 1 and 1000),
  constraint matching_rules_configuration_object check (jsonb_typeof(configuration) = 'object'),
  unique (id, workspace_id)
);

create index matching_rules_active_idx on public.matching_rules (workspace_id, is_active, priority);

create table public.reconciliation_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  match_id uuid,
  payment_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action_type text not null,
  decision_note text,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint reconciliation_actions_match_workspace_fk foreign key (match_id, workspace_id)
    references public.matches(id, workspace_id) on delete set null (match_id),
  constraint reconciliation_actions_payment_workspace_fk foreign key (payment_id, workspace_id)
    references public.payments(id, workspace_id) on delete restrict,
  constraint reconciliation_actions_type_check check (action_type in ('approve', 'reject', 'select_invoices', 'split', 'mark_partial', 'record_difference', 'leave_unmatched', 'add_note', 'export')),
  constraint reconciliation_actions_previous_object check (jsonb_typeof(previous_state) = 'object'),
  constraint reconciliation_actions_new_object check (jsonb_typeof(new_state) = 'object'),
  unique (workspace_id, idempotency_key)
);

create index reconciliation_actions_payment_idx on public.reconciliation_actions (workspace_id, payment_id, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user',
  event_type text not null,
  entity_type text,
  entity_id uuid,
  request_id text,
  source_import_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint audit_events_workspace_org_fk foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint audit_events_import_workspace_fk foreign key (source_import_id, workspace_id)
    references public.imports(id, workspace_id) on delete set null (source_import_id),
  constraint audit_events_import_scope_check check (source_import_id is null or workspace_id is not null),
  constraint audit_events_actor_type_check check (actor_type in ('user', 'system', 'integration', 'support')),
  constraint audit_events_type_not_blank check (btrim(event_type) <> ''),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);
create index audit_events_workspace_created_idx on public.audit_events (workspace_id, created_at desc) where workspace_id is not null;
create index audit_events_entity_idx on public.audit_events (workspace_id, entity_type, entity_id, created_at desc) where entity_id is not null;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers', 'payer_aliases', 'payment_sources', 'imports', 'import_rows',
    'invoices', 'payments', 'matches', 'match_invoice_links', 'match_explanations', 'matching_rules'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app_private.can_access_workspace(workspace_id))',
      table_name || '_select_workspace', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app_private.can_edit_workspace(workspace_id))',
      table_name || '_insert_editor', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id))',
      table_name || '_update_editor', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app_private.can_edit_workspace(workspace_id))',
      table_name || '_delete_editor', table_name
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function app_private.prevent_tenant_reassignment(''workspace_id'')',
      table_name || '_prevent_workspace_reassignment', table_name
    );
  end loop;
end
$$;

alter table public.reconciliation_actions enable row level security;
create policy reconciliation_actions_select_workspace on public.reconciliation_actions
for select to authenticated using (app_private.can_access_workspace(workspace_id));
create policy reconciliation_actions_insert_editor on public.reconciliation_actions
for insert to authenticated with check (
  app_private.can_edit_workspace(workspace_id)
  and actor_user_id = auth.uid()
);

alter table public.audit_events enable row level security;
create policy audit_events_select_org_member on public.audit_events
for select to authenticated using (app_private.is_org_member(organization_id));
create policy audit_events_insert_org_editor on public.audit_events
for insert to authenticated with check (
  app_private.has_org_role(organization_id, array['owner', 'admin', 'member'])
  and actor_user_id = auth.uid()
  and actor_type = 'user'
);

create trigger payer_aliases_validate_confirmer before insert or update on public.payer_aliases
for each row execute function app_private.validate_authenticated_actor('confirmed_by');
create trigger imports_validate_creator before insert or update on public.imports
for each row execute function app_private.validate_authenticated_actor('created_by');
create trigger imports_prevent_creator_reassignment before update on public.imports
for each row execute function app_private.prevent_tenant_reassignment('created_by');
create trigger matches_validate_resolver before insert or update on public.matches
for each row execute function app_private.validate_authenticated_actor('resolved_by');
create trigger matching_rules_validate_creator before insert or update on public.matching_rules
for each row execute function app_private.validate_authenticated_actor('created_by');
create trigger matching_rules_prevent_creator_reassignment before update on public.matching_rules
for each row execute function app_private.prevent_tenant_reassignment('created_by');
create trigger reconciliation_actions_validate_actor before insert on public.reconciliation_actions
for each row execute function app_private.validate_authenticated_actor('actor_user_id');
create trigger audit_events_validate_actor before insert on public.audit_events
for each row execute function app_private.validate_authenticated_actor('actor_user_id');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers', 'payer_aliases', 'payment_sources', 'imports',
    'invoices', 'payments', 'matches', 'matching_rules'
  ]
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app_private.touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
end
$$;

revoke all on public.customers, public.payer_aliases, public.payment_sources, public.imports,
  public.import_rows, public.invoices, public.payments, public.matches, public.match_invoice_links,
  public.match_explanations, public.matching_rules, public.reconciliation_actions, public.audit_events
  from anon, authenticated;
grant select, insert, update, delete on public.customers, public.payer_aliases, public.payment_sources,
  public.imports, public.import_rows, public.invoices, public.payments, public.matches,
  public.match_invoice_links, public.match_explanations, public.matching_rules to authenticated;
grant select on public.reconciliation_actions, public.audit_events to authenticated;
grant insert (
  workspace_id, match_id, payment_id, actor_user_id, action_type,
  decision_note, previous_state, new_state, idempotency_key
) on public.reconciliation_actions to authenticated;
grant insert (
  organization_id, workspace_id, actor_user_id, event_type, entity_type,
  entity_id, request_id, source_import_id, metadata, ip_hash, user_agent
) on public.audit_events to authenticated;
grant usage on sequence public.audit_events_id_seq to authenticated;

commit;
