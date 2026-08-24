begin;

alter table public.contact_requests
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists last_delivery_attempt_at timestamptz,
  add column if not exists delivery_error_code text;

alter table public.contact_requests
  drop constraint if exists contact_requests_delivery_status_check;
alter table public.contact_requests
  add constraint contact_requests_delivery_status_check
  check (delivery_status in ('pending', 'delivered', 'failed', 'demo'));
alter table public.contact_requests
  drop constraint if exists contact_requests_delivery_attempts_check;
alter table public.contact_requests
  add constraint contact_requests_delivery_attempts_check check (delivery_attempts >= 0);

create index if not exists contact_requests_delivery_queue_idx
  on public.contact_requests (delivery_status, created_at desc)
  where delivery_status in ('pending', 'failed');

-- Remove the earlier column-level writer grants as well as table-level grants.
revoke insert (
  event_id, event_name, anonymous_id, session_id, user_id, organization_id,
  workspace_id, path, referrer_host, utm_source, utm_medium, utm_campaign, properties
) on public.analytics_events from anon, authenticated;
revoke insert (name, email, subject, message, source_path)
  on public.contact_requests from anon, authenticated;

commit;
