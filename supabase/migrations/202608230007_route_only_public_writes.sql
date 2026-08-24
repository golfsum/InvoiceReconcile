begin;

drop policy if exists analytics_events_insert_anonymous on public.analytics_events;
drop policy if exists analytics_events_insert_authenticated on public.analytics_events;
drop policy if exists contact_requests_insert_public on public.contact_requests;
drop policy if exists feedback_insert_authenticated on public.feedback;

drop policy if exists customers_insert_editor on public.customers;
drop policy if exists customers_update_editor on public.customers;
drop policy if exists customers_delete_editor on public.customers;
drop policy if exists payer_aliases_insert_editor on public.payer_aliases;
drop policy if exists payer_aliases_update_editor on public.payer_aliases;
drop policy if exists payer_aliases_delete_editor on public.payer_aliases;
drop policy if exists payment_sources_insert_editor on public.payment_sources;
drop policy if exists payment_sources_update_editor on public.payment_sources;
drop policy if exists payment_sources_delete_editor on public.payment_sources;
drop policy if exists imports_insert_editor on public.imports;
drop policy if exists imports_update_editor on public.imports;
drop policy if exists imports_delete_editor on public.imports;
drop policy if exists import_rows_insert_editor on public.import_rows;
drop policy if exists import_rows_update_editor on public.import_rows;
drop policy if exists import_rows_delete_editor on public.import_rows;
drop policy if exists invoices_insert_editor on public.invoices;
drop policy if exists invoices_update_editor on public.invoices;
drop policy if exists invoices_delete_editor on public.invoices;
drop policy if exists payments_insert_editor on public.payments;
drop policy if exists payments_update_editor on public.payments;
drop policy if exists payments_delete_editor on public.payments;
drop policy if exists matches_insert_editor on public.matches;
drop policy if exists matches_update_editor on public.matches;
drop policy if exists matches_delete_editor on public.matches;
drop policy if exists match_invoice_links_insert_editor on public.match_invoice_links;
drop policy if exists match_invoice_links_update_editor on public.match_invoice_links;
drop policy if exists match_invoice_links_delete_editor on public.match_invoice_links;
drop policy if exists match_payment_links_insert_editor on public.match_payment_links;
drop policy if exists match_payment_links_update_editor on public.match_payment_links;
drop policy if exists match_payment_links_delete_editor on public.match_payment_links;
drop policy if exists match_explanations_insert_editor on public.match_explanations;
drop policy if exists match_explanations_update_editor on public.match_explanations;
drop policy if exists match_explanations_delete_editor on public.match_explanations;
drop policy if exists matching_rules_insert_editor on public.matching_rules;
drop policy if exists matching_rules_update_editor on public.matching_rules;
drop policy if exists matching_rules_delete_editor on public.matching_rules;
drop policy if exists reconciliation_actions_insert_editor on public.reconciliation_actions;
drop policy if exists audit_events_insert_org_editor on public.audit_events;
drop policy if exists integrations_insert_org_admin on public.integrations;
drop policy if exists integrations_update_org_admin on public.integrations;
drop policy if exists integrations_delete_org_admin on public.integrations;

revoke insert on public.analytics_events from anon, authenticated;
revoke insert on public.contact_requests from anon, authenticated;
revoke usage on sequence public.analytics_events_id_seq from anon, authenticated;
revoke insert, update, delete on
  public.customers,
  public.payer_aliases,
  public.payment_sources,
  public.imports,
  public.import_rows,
  public.invoices,
  public.payments,
  public.matches,
  public.match_invoice_links,
  public.match_payment_links,
  public.match_explanations,
  public.matching_rules,
  public.integrations
from authenticated;
revoke insert, update, delete on public.reconciliation_actions, public.audit_events from authenticated;
revoke insert (
  workspace_id, match_id, payment_id, actor_user_id, action_type,
  decision_note, previous_state, new_state, idempotency_key
) on public.reconciliation_actions from authenticated;
revoke insert (
  organization_id, workspace_id, actor_user_id, event_type, entity_type,
  entity_id, request_id, source_import_id, metadata, ip_hash, user_agent
) on public.audit_events from authenticated;
revoke usage on sequence public.audit_events_id_seq from authenticated;
revoke insert (
  user_id, organization_id, workspace_id, feedback_type, rating, message,
  contact_email, page_path
) on public.feedback from authenticated;

grant insert on public.analytics_events, public.contact_requests, public.feedback to service_role;
grant usage on sequence public.analytics_events_id_seq to service_role;

comment on table public.analytics_events is
  'Analytics events are written only by the validated, rate-limited application route using the service role.';
comment on table public.contact_requests is
  'Contact requests are written only by the validated, rate-limited application route using the service role.';
comment on table public.feedback is
  'User feedback is written only by the authenticated, validated, rate-limited application route using the service role.';
comment on table public.reconciliation_actions is
  'Financial actions are written only by audited, security-definer reconciliation functions.';
comment on table public.audit_events is
  'Audit events are written only inside trusted server workflows and security-definer functions.';

commit;
