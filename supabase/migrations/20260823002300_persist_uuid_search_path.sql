-- persist_reconciliation_run_v2 initializes v_run_id with gen_random_uuid()
-- while search_path is empty. On Supabase that function lives in extensions,
-- so the save fails with 42883 before any run rows are written. Keep public
-- off the search_path so callers cannot inject a public schema object.

alter function public.persist_reconciliation_run_v2(uuid, text, text, jsonb, jsonb, jsonb)
  set search_path = pg_catalog, extensions;
