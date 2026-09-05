# Customer-only admin reporting

The live admin loader filters internal activity before computing dashboard totals.
This is reporting metadata only: source accounts, subscriptions, accounting data,
support messages and audit records remain unchanged.

`public.admin_reporting_exclusions` holds exact user, organization, contact-request,
anonymous-browser or session IDs and the reason for each exclusion. It is RLS-enabled
and readable only by the server service role; ordinary users cannot read or change it.
Use an authorized database administration session to maintain these records.

User exclusions also remove organizations created by those users if they have no
active non-excluded members. Organizations with real customer members are retained.
Internal admin flags and the `ADMIN_EMAILS` allowlist are automatically respected.
QA accounts are excluded without granting them admin privileges.

Pre-login events are linked only by browser/session identifiers actually observed
on excluded activity. Shared identifiers observed on identified customers are not
automatically excluded. Unknown anonymous visits remain included. Individual setup
contact tests are excluded by exact record ID, not by a broad email-domain rule.

Mixed global daily rollups cannot be safely corrected by subtraction, so when
internal exclusions exist the loader rebuilds totals from filtered raw events and
usage records. Retain these raw reporting sources for the required reporting window.

To reverse a manually registered exclusion, remove only its exact `(kind, subject_id)`
registry row. No source records need restoration. Automatically excluded admins
remain excluded while their admin flag or email allowlist entry is present.

Regression coverage: `npx vitest run tests/admin`. For a read-only live scope audit,
pipe Supabase query JSON with `rows[0].snapshot` (table-name to array of source rows,
including the exclusion registry) into
`node --import tsx scripts/check-admin-reporting-scope.ts`. It outputs counts only.
