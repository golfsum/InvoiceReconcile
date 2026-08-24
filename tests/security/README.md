# Database security test plan

Run `supabase db reset`, then execute `tests/security/rls.pgtap.sql` and `tests/security/async-imports.pgtap.sql` against the local database with the Supabase SQL test runner or `psql`. Both scripts roll back all fixtures.

The pgTAP suite verifies:

- every public application table has RLS enabled
- cross-organization reads return no rows
- cross-organization writes fail
- editors can write within their workspace while viewers cannot
- organization admins cannot create or promote another owner
- users cannot grant themselves internal admin access
- internal admins can inspect signup, billing, analytics, and job metadata
- internal admins cannot inspect invoices, payments, or tenant source files
- the import file bucket is private
- storage paths must map to an existing import under the correct organization and workspace
- duplicate file fingerprints, payment dedupe keys, and match idempotency keys fail safely
- anonymous callers cannot insert analytics or contact rows directly
- the trusted route writer can store already validated analytics and contact submissions
- durable import tenant isolation, viewer denial, and service-only worker authority
- exact immutable source paths and non-capability intents that cannot fence deletion
- revoked service-role table DML with constrained worker RPC mutation
- revoked membership at worker claim, stale preview and reconciliation lease cleanup, deletion-pending state, and verified deletion receipts
- workspace and organization deletion fences before object removal, with deletion allowed only after a receipt

API-level checks are still required in CI because PostgreSQL does not create or validate signed URLs. Use two real Supabase Auth sessions and verify that a signed URL requested by tenant A can download tenant A's object for its short lifetime, tenant B cannot create that URL, the URL expires, and the bucket never returns a public URL. Also test MIME sniffing and file size rejection at the API boundary. Database policy checks complement those validations but do not replace them.

Service-role regression checks should also run in a separate trusted test process. Verify that the service role can claim a job and write normalized rows, then confirm that no service-role key appears in browser bundles, logs, analytics properties, or client environment variables.
