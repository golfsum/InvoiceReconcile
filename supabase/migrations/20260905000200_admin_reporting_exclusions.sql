begin;

-- Reversible reporting metadata only. No account, financial or audit deletion.
create table public.admin_reporting_exclusions (
  kind text not null check (kind in ('user', 'organization', 'contact_request', 'anonymous', 'session')),
  subject_id uuid not null,
  reason text not null check (btrim(reason) <> ''),
  created_at timestamptz not null default now(),
  primary key (kind, subject_id)
);
alter table public.admin_reporting_exclusions enable row level security;
revoke all on public.admin_reporting_exclusions from public, anon, authenticated, service_role;
grant select on public.admin_reporting_exclusions to service_role;

insert into public.admin_reporting_exclusions (kind, subject_id, reason)
select 'user', id, 'Confirmed owner/admin or launch QA account; excluded from customer reporting'
from public.profiles
where (id = 'b3e9b70b-fb4e-4778-82c2-d70383ad95c5' and lower(email) = 'nd82soft@gmail.com')
   or (id = '9c686a91-bb90-4cdf-a18c-de7e426bfcf1' and lower(email) = 'qa-20260904@invoicereconcile.com')
   or (id = 'f30b4f03-50dd-42af-a5b4-18f2430ea2ee' and lower(email) = 'contact@invoicereconcile.com')
   or (id = '72871273-b4ac-4d81-9261-dfd605578794' and lower(email) = 'ndodds64@yahoo.com');

insert into public.admin_reporting_exclusions (kind, subject_id, reason)
select 'contact_request', id, 'Confirmed transactional email setup delivery test'
from public.contact_requests
where id in ('c0b8bb91-a91f-4453-9824-e1197e9a748a', '894398bf-da3a-420a-8f05-a366cdecec63')
  and lower(email) = 'contact@invoicereconcile.com';

comment on table public.admin_reporting_exclusions is
  'Server-only, reversible exclusions from customer dashboard reporting. Does not grant admin access or change billing.';
commit;
