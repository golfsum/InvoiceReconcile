begin;

-- Preserve the deployed worker authorization and privileges while repairing
-- expressions that PostgreSQL cannot compile on the affected runtime paths.
do $$
declare
  v_signature text;
  v_definition text;
  v_repaired text;
begin
  v_signature := 'public.persist_reconciliation_run_v2(uuid,text,text,jsonb,jsonb,jsonb)';
  v_definition := pg_get_functiondef(v_signature::regprocedure);
  v_repaired := replace(v_definition, 'jsonb_object_length(v_invoice_map)',
    '(select count(*) from jsonb_object_keys(v_invoice_map))');
  v_repaired := replace(v_repaired, 'jsonb_object_length(v_payment_map)',
    '(select count(*) from jsonb_object_keys(v_payment_map))');
  if v_repaired = v_definition then raise exception 'Expected map length expressions were not found'; end if;
  execute v_repaired;

  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_latest_reconciliation_run_items';
  v_repaired := replace(v_definition, 'from jsonb_array_elements(v_items) value',
    'from jsonb_array_elements(v_items) item(value)');
  v_repaired := replace(v_repaired, 'entry.key = value ->> ''id''',
    'entry.key = (item.value ->> ''id'')');
  if v_repaired = v_definition then raise exception 'Expected invoice balance expressions were not found'; end if;
  execute v_repaired;

  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'update_workspace_custom_matching_rule', 'delete_workspace_custom_matching_rule',
      'update_workspace_payer_mapping', 'delete_workspace_payer_mapping'
    )
  loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    -- A composite expression is one column; a %rowtype target needs its fields.
    v_repaired := regexp_replace(v_definition, 'select ([ra])([[:space:]]+)into',
      'select \1.*\2into', 'gi');
    if v_repaired = v_definition then raise exception 'Expected row selection not found in %', v_signature; end if;
    execute v_repaired;
  end loop;
end;
$$;

commit;
