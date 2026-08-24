# InvoiceReconcile data architecture

## Scope and invariants

The database is the authorization boundary for all customer financial data. Server authorization checks are still required, but no browser or application bug should be able to bypass organization isolation through the Supabase Data API.

The core invariants are:

- An organization owns one or more workspaces.
- A membership grants access to every active workspace in its organization.
- `viewer` can read. `member`, `admin`, and `owner` can work with reconciliation data. Only `admin` and `owner` manage integrations and most organization settings. Only `owner` can create, promote, or remove another owner.
- Every financial row carries `workspace_id`. Composite foreign keys ensure related records use the same workspace.
- Workspace and organization tenant keys cannot be changed after insertion.
- Money is stored in integer minor units with a three-letter ISO currency code. No floating point type is used for financial amounts.
- Parsed source values are retained in import-row and financial-source JSON. Core query fields stay normalized and indexed. The synchronous path for files up to 2 MiB does not deliberately retain an application-storage copy. The background path temporarily stores source objects in the private import bucket and uses verified, capability-safe deletion.
- Currency conversion is not implicit. The matching layer must block automatic application across currencies.
- Suggestions never post to an accounting system. A human decision is recorded through immutable reconciliation and audit events.

## Migration order

| Migration | Responsibility |
| --- | --- |
| `202608230001_core_tenancy.sql` | Profiles, organizations, memberships, workspaces, auth profile trigger, tenant helper functions, foundational RLS |
| `202608230002_reconciliation.sql` | Customers, aliases, payment sources, imports, source rows, invoices, payments, matching, explanations, rules, actions, audit events |
| `202608230003_operations_analytics.sql` | Integrations, subscriptions, usage, privacy-safe analytics, feedback, jobs, errors, contact requests |
| `202608230004_private_storage.sql` | Provisioned private source-file bucket, size and MIME allowlist, and path authorization policies |
| `202608230005_onboarding_function.sql` | Atomic organization, owner membership, first workspace, and free-subscription onboarding |
| `202608230006_durable_reconciliation_runs.sql` | Atomic imported-run persistence, exact result snapshots, grouped-payment links, transactional decisions, paginated audit reads, audited exports, usage, and current-state reads |
| `202608230007_route_only_public_writes.sql` | Removes direct browser inserts for analytics and contact requests so validated, rate-limited service routes are the only public write path |
| `202608230008_billing_entitlements.sql` | First-paid tracking, plan payment limits, concurrent usage reservations, and capacity enforcement before a reconciliation run is committed |
| `202608230010_contact_delivery_queue.sql` | Contact-delivery state and retry indexing, plus removal of earlier column-level public writer grants |
| `202608230011_reconciliation_operational_metrics.sql` | Idempotent usage and privacy-safe analytics metrics for completed runs and rejected suggestions |
| `202608230012_workspace_lifecycle.sql` | Plan-aware workspace creation, audited settings and synchronous deletion RPCs, direct-mutation revocation, and portfolio metrics |
| `202608230013_explicit_reconciliation_allocations.sql` | Explicit per-invoice reviewer allocations, atomic balance changes, and retirement of the legacy inferred-allocation decision RPC |
| `202608230014_initial_workspace_matching_window.sql` | Existing-window normalization, the 1-to-365-day post-invoice constraint, and timezone-validated first-workspace defaults |
| `202608230015_cross_file_canonical_deduplication.sql` | Workspace-wide canonical invoice and payment identities, cross-file duplicate evidence, import context lookup, and canonical run persistence |
| `202608230016_workspace_payer_mappings.sql` | Tenant-checked, audited payer-mapping creation and deactivation with direct alias mutations removed from browser roles |
| `202608230021_workspace_custom_matching_rules.sql` | Business and Bookkeeper description mappings, bounded reference templates, fee-review evidence, audited route-only CRUD, and behavior fingerprints |

Apply migrations through the Supabase migration runner. Do not edit an applied migration in production. Add a later migration for every production change.

The repository currently has no `202608230009` migration file. Keep the existing filenames stable rather than renumbering later migrations.

## Relationship map

```text
auth.users
  -> profiles
     -> memberships -> organizations -> subscriptions
                             |          -> usage_records
                             |          -> integrations
                             |          -> workspaces
                             |                -> customers -> payer_aliases
                             |                -> payment_sources
                             |                -> imports -> import_rows
                             |                -> invoices
                             |                -> reconciliation_usage_reservations
                             |                -> reconciliation_runs -> matches
                             |                -> payments -> match_payment_links -> matches
                             |                                -> match_invoice_links -> invoices
                             |                                -> match_explanations
                             |                -> matching_rules
                             |                -> reconciliation_actions
                             |                -> audit_events
                             |                -> background_jobs -> application_errors
                             -> analytics_events -> analytics_daily_aggregates
```

`feedback`, `analytics_events`, and `application_errors` may have a user, organization, and workspace scope. Their composite foreign keys prevent a workspace from being labeled with the wrong organization.

## Table responsibilities

### Identity and tenants

`profiles` mirrors only the auth fields needed by the product and internal signup dashboard. The `is_internal_admin` flag is not writable by an authenticated user. It must be changed through a controlled, audited server operation.

`organizations` is the billing and team boundary. `memberships` stores one active role per user and organization. Invitations can exist before an auth user accepts them. `workspaces` represents a business or bookkeeping client and holds currency, timezone, and matching-window defaults.

Initial onboarding uses `create_initial_workspace` to insert the organization, first active owner membership, workspace defaults, and free subscription in one transaction after the auth profile exists. Additional workspaces use the plan-aware `create_additional_workspace` RPC. Browser roles no longer receive direct workspace or membership insert, update, or delete privileges. Business and Bookkeeper owners or admins create audited seven-day colleague invitations through a plan-aware RPC. Acceptance requires a signed-in user whose email is verified and exactly matches the pending invitation.

### Imports and financial records

`imports` stores file metadata, a SHA-256 fingerprint, mapping choices, counts, progress, and optional private-object coordinates. The synchronous CSV and XLSX path reads up to 2 MiB per file in request memory, persists metadata and parsed evidence, leaves `storage_bucket` and `storage_path` unset, and does not deliberately retain an application-storage copy. The background path accepts files up to 50 MiB through a server-minted signed capability for one exact private object path. `import_source_uploads` binds the actor, organization, workspace, kind, expected size, SHA-256 digest, MIME type, nonce, lifecycle state, worker claim, and verified deletion receipt. A partial unique index prevents the same active file fingerprint and mapping from being imported twice for the same workspace and record type. Reusing an unchanged source import across reconciliation runs preserves source identity without copying raw rows.

`import_rows` keeps every source row and its disposition. Blank, rejected, and duplicate rows remain explainable. `raw_values` is the original row object. `normalized_values` contains the parser result. `issue_codes` contains machine-readable reasons. These JSON columns are justified because source columns vary by file, while the accepted invoice and payment fields are normalized into relational columns.

Cross-file canonical deduplication is separate from file-level idempotency. Before matching, `get_reconciliation_import_context` resolves normalized rows against workspace-wide invoice and payment identities. `persist_reconciliation_run_v2` remaps repeated source rows to the existing canonical financial records, records duplicate evidence on the new import rows, and prevents those repeated records from being processed as new money.

`customers` and `payer_aliases` support deterministic identity matching. `invoices` and `payments` store queryable dates, references, amounts, status, dedupe keys, and remaining balances. Their `raw_source` objects are evidence for support and audit, not the primary application model.

`payment_sources` identifies the bank export, processor, accounting integration, or sample source without storing credentials.

### Matching and reconciliation

`reconciliation_runs` groups the two source imports, engine version, exact result snapshot, reconciliation context, actor, and completion time. The snapshot is the lossless persistence record. `reconciliation_run_read_items` materializes bounded invoice, payment, and match pages so a large saved run can reopen without sending the entire snapshot through an RSC or route response. The compact overview RPC returns metrics and at most four preview rows, while the item RPC caps each page at 100. The synchronous `persist_reconciliation_run_v2` RPC authorizes an editor and writes the run transactionally. The service-only worker entry point requires a leased claim, rechecks actor membership and plan entitlement, preserves the original submitter in audit metadata, and delegates to the same private persistence invariant. Demo processing remains browser-local, but a live run never reports success unless the transaction is durable.

The live upload response is a compact receipt containing IDs and counts. It does not echo the full financial snapshot through the function response. Legacy small runs may still use `get_latest_reconciliation_run`; background runs use the compact overview and paged read-item RPCs. Server-side exports page through the read model and record an audit event before the download is returned. The browser-local demo response is measured before sending to stay below the hosting function payload ceiling. The durable run key includes file fingerprints, mappings, workspace currency, matching-window bounds, the payer-mapping fingerprint, and the eligible custom-rule fingerprint so a settings or rule change creates a distinct result identity in both synchronous and durable workflow processing.

The workspace archive in Settings is assembled by the signed-in browser. It reads each selected workspace-scoped table in ID order with bounded pages, applies RLS to every query, and creates one local JSON download after all pages arrive. It is not a server-built background archive. It contains stored import metadata and parsed evidence, not original CSV or XLSX objects, and its integration selection excludes secret-reference fields.

`matches` is an engine proposal with one primary payment for indexed review queries. `match_payment_links` preserves every payment in grouped-payment matches. `match_invoice_links` stores each proposed allocation. `match_explanations` stores factual reason codes, display order, and compact evidence. The workspace-scoped idempotency key includes the durable run identity.

`matching_rules` contains inspectable description-to-customer mappings, bounded reference templates, and accepted fee-review evidence. Business and Bookkeeper plans in active organizations can create, update, or apply these rules; downgraded workspaces cannot apply them. Downgraded active workspaces can still inspect and delete stored rules. Authorized editors may also delete stored rules after organization suspension so cleanup does not require restoring active or paid status. `payer_aliases` remains normalized separately because it is a high-volume indexed identity mapping available to Solo workspaces. Browser clients cannot mutate either table directly. Owners, admins, and members use same-origin, validated, rate-limited routes backed by tenant-checked security-definer RPCs. Viewers retain read-only RLS access.

Reference templates allow exactly one `{digits}` or `{alnum}` token and never store or execute a user regex. Description and fee patterns are bounded normalized literals. Rules are compiled and evaluated once per payment before scoring. Conflicting description targets contribute no identity evidence. Fee behavior can annotate only an already-eligible possible fee or deduction, remains bounded by the engine's global thresholds, and always requires a person's confirmation. Create, update, and delete events store sanitized previous and current rule state without imported file rows, payment descriptions, invoice values, filenames, or storage credentials.

`reconciliation_actions` is append-only for authenticated users. It records the actor, payment, optional match, previous state, new state, and a request idempotency key. `record_reconciliation_decision_v2` validates explicit per-invoice allocations, locks the match, linked payments, and selected invoices, changes balances, resolves the proposal, and appends the action and audit event in one transaction. The immutable state records the original payment links, proposed invoice links, exact payment and invoice applications, source imports, matching method, confidence, and copied engine evidence.

`audit_events` is also append-only. Updates and deletes are not granted to authenticated clients. `get_workspace_audit_events` verifies workspace access inside a security-definer function and returns keyset-paginated history with the actual actor, source import, and related action states. `record_reconciliation_export` writes an idempotent audit event before a durable CSV or XLSX download is released to the browser. Demo and explicitly local data do not claim a workspace audit record.

Application code should reconcile in one transaction:

1. Lock the payment and relevant invoices.
2. Confirm their currencies and current balances.
3. Insert the reconciliation action with an idempotency key.
4. Update invoice balances, payment unapplied amount, and match status.
5. Insert an audit event.
6. Commit once all invariants pass.

Retrying the same action must return the existing result rather than apply money twice.

### Billing, operations, and admin metrics

`subscriptions` keeps provider identifiers, plan, status, amount, quantity, currency, and interval. `monthly_recurring_revenue_minor` is generated from normalized billing data. Annual revenue is divided by twelve for MRR. Stripe webhooks remain the source of truth and must be verified before writes.

`usage_records` tracks billable product counts by period. A provider or application event ID makes increments idempotent. `reconciliation_usage_reservations` locks plan capacity across concurrent requests and is committed only when the corresponding durable run is inserted.

`analytics_events` contains visitor and product funnel events. It supports anonymous visitors, sessions, acquisition tags, signup history, first import, first match, and first completed reconciliation. A constraint rejects common financial and personally identifying property keys. Application validation must use a strict event schema and must never send invoice values, customer names, payer names, payment descriptions, memos, references, email addresses, or filenames.

`analytics_daily_aggregates` supports website and launch dashboards without scanning the event stream. Useful metrics include unique visitors, tool users, signups, activated users, imports completed, payments processed, match categories, rejected suggestions, checkouts, paying organizations, and MRR. `dimension_key` is a canonical string produced by the aggregator so the upsert key stays stable.

`background_jobs` stores only scheduling state, progress, idempotency, and a pointer to a protected payload. It must not contain raw financial payloads. `application_errors` stores safe operational context. Secret-shaped fields are rejected. Full traces belong in a protected log service with a short retention window.

`feedback` supports signed-in product feedback. `contact_requests` supports the public contact form for support@invoicereconcile.com. Browser roles cannot insert contact or analytics rows directly. Validated, rate-limited application routes perform those writes with a server-only service role after bot checks, email normalization, and abuse controls.

## RLS and administrative access

All public application tables have RLS enabled. Helper functions in `app_private` are `SECURITY DEFINER`, use an empty `search_path`, and expose only boolean tenant decisions. Execute access is limited to the authenticated role where required.

| Data class | Tenant member | Tenant editor | Internal admin | Service role |
| --- | --- | --- | --- | --- |
| Profiles | Own profile | Own safe columns | Read signups | Controlled maintenance |
| Organizations and workspaces | Read own | Role-dependent settings | Read metadata | Controlled maintenance |
| Invoices, payments, imports, matches | Read own workspace | Write own workspace | No access | Background processing |
| Private background-import source files | Inspect safe status for own workspace | Initialize, finalize, or request removal through scoped RPCs | No access | Exact-path processing and verified deletion |
| Subscriptions and usage | Read own organization | Read own organization | Read all | Stripe and metering writes |
| Analytics and aggregates | Submit through route | Submit through route | Read all | Validated inserts, aggregation, and retention |
| Jobs and errors | Read own organization | Report own errors | Read failures | Claim and update jobs |
| Feedback and contact | Submit through route or read own feedback | Submit through route | Triage | Validated contact writes and maintenance |

Internal admin is an operational role, not a tenant superuser. It can view signups, organization and workspace metadata, subscriptions, usage, privacy-safe activity history, failed jobs, errors, feedback, and contact requests. It has no RLS policy for invoices, payments, customers, matches, import rows, audit data, integrations, or files. If customer support needs a financial example, the customer should provide a redacted sample through a deliberate support process.

The service role bypasses RLS and is therefore restricted to trusted server and worker processes. Never expose it to a browser, mobile bundle, client environment variable, analytics event, support log, or error response. Service operations must still provide an explicit organization and workspace, validate their relationship, use idempotency keys, and write audit records. RLS bypass is not permission to omit application authorization.

## Private files and signed access

Migration 004 provisions the private `import-source-files` bucket with a 50 MiB limit and a narrow MIME allowlist. The synchronous 2 MiB CSV and XLSX path does not write original files to this bucket. It parses the request, retains metadata and source-row evidence, and releases request bytes after processing. The background path uses the bucket for temporary source objects.

### Background stored-file support

The required object name is derived server-side and contains no caller-selected path segment:

```text
{organization_uuid}/{workspace_uuid}/{source_uuid}/{kind}.{canonical_extension}
```

The browser never receives direct table or bucket policy authority. An authenticated initialization RPC checks an editor role and current plan entitlement, creates an immutable source intent, and returns only safe metadata. A server-only route registers each signed capability and verifies that its exact bucket and path match the intent before returning the upload token. The token uses `upsert: false`. Finalization compares exact storage metadata before queueing, and the worker downloads only the bucket and path stored in the immutable intent. It recomputes actual bytes and SHA-256 before parsing.

Signed upload tokens are bearer credentials that Supabase may accept for two hours. Each issuance therefore advances `upload_capability_safe_delete_at` by a conservative five-minute buffer, and no deletion RPC can return or confirm object removal before that timestamp. Signed URLs and tokens are never stored or logged. The worker validates extension, canonical MIME, magic bytes, actual byte count, checksum, actual XLSX expansion, worksheet dimensions, header count and length, row width, per-cell text length, row count, and total parsed characters before matching. ExcelJS still materializes a workbook after the 64 MiB actual-expansion check; worker memory isolation and hostile-workbook load testing remain a staged hardening item.

Object deletion and source-row state are separate operations. Processing success, permanent preview failure, user removal, or retention expiry first transitions the source to durable `pending` deletion. A Workflow DevKit lifecycle waits until the capability-safe time, requests the exact path from a service-only compare-and-set RPC, removes it idempotently, and records `object_deleted_at` only after Storage confirms success. Provider failures increment bounded safe telemetry and remain pending for retry. The 24-hour lifecycle schedules every remaining source for cleanup and reclaims expired preview or reconciliation leases. Workspace and organization deletion are fenced until all related source objects have confirmed deletion receipts, preventing storage orphans after database cascades.

## Idempotency and duplicate handling

- Import idempotency: unique workspace, record type, file SHA-256, and mapping fingerprint for non-cancelled imports.
- Run idempotency: unique `(workspace_id, run_key, engine_version)`, where the key includes both applied payer and custom-rule fingerprints.
- Row duplicate evidence: SHA-256 `dedupe_hash` on each import row.
- Invoice and payment duplicates: one active `dedupe_key` per workspace, with an explicit `duplicate_of_id` for records retained as evidence.
- Matching idempotency: unique `(workspace_id, idempotency_key)`.
- Reconciliation idempotency: unique `(workspace_id, idempotency_key)` on immutable actions.
- Job idempotency: unique organization and idempotency key, including global jobs where the organization is null.
- Usage idempotency: unique organization and source event ID.
- Analytics ingestion: unique event UUID.

The application should treat unique violations on these keys as a successful replay lookup, not as an unknown server failure.

## Current indexes and future scaling

Current indexes support workspace queues, open invoice candidate lookup, payment candidate lookup, customer normalization, recent imports, match review, audit history, failed jobs, visitor events, user activity, subscriptions, and daily aggregates.

Future scaling recommendations when volume grows:

1. Use cursor pagination based on `(created_at, id)` or domain date plus ID. Never use deep offsets for transaction tables.
2. Keep combination matching in bounded background jobs. Query candidates through the partial invoice and payment indexes before subset search.
3. Batch import rows with `COPY` or server-side bulk inserts. Do not send thousands of single-row browser requests.
4. Partition `analytics_events`, `audit_events`, `application_errors`, and high-volume `usage_records` by month when index and vacuum cost justifies it. The current schemas and time indexes make that migration straightforward.
5. Move analytics events older than the active window to object storage or delete them after aggregation. Keep daily aggregates longer.
6. Use a worker claim function with `FOR UPDATE SKIP LOCKED` when multiple job workers are enabled. Add lease recovery based on `locked_at`.
7. Add read replicas only after query evidence shows a need. Reconciliation transactions must continue to use the primary.
8. Monitor index hit rate, dead tuples, RLS query plans, job age, import throughput, and storage growth. Run `EXPLAIN (ANALYZE, BUFFERS)` against representative tenant sizes before changing indexes.

## Retention and deletion

Retention distinguishes original objects from structured Customer Content:

| Data | Suggested active retention | Deletion behavior |
| --- | --- | --- |
| Synchronous CSV and XLSX request bytes up to 2 MiB | Not deliberately retained in application storage | Released after request processing; no original is included in the workspace archive |
| Private background-import source objects up to 50 MiB | Temporary; every source enters the 24-hour cleanup schedule | Mark pending after processing, permanent preview failure, user request, or expiry; wait for the two-hour upload capability plus safety buffer; retry until Storage confirms removal |
| Raw import rows and raw source JSON | 90 days, configurable shorter | Redact or delete after export and support window |
| Normalized invoices, payments, and matches | While workspace is active | Export, then cascade on verified workspace deletion |
| Reconciliation and audit history | 7 years only if the customer chooses accounting-record retention | Export before deletion; legal requirements vary |
| Analytics events | 13 months | Aggregate, then delete or anonymize |
| Daily analytics aggregates | 25 months or longer if fully anonymous | Delete organization dimensions with tenant deletion |
| Application errors and job failures | 30 to 90 days | Remove safe context and payload references |
| Contact requests and feedback | 24 months after resolution | Delete sooner on valid request where allowed |
| Canceled subscription metadata | Required tax and billing period | Follow Stripe and applicable financial record rules |

Workspace deletion remains synchronous after its preconditions pass. An owner types `DELETE`, the server action calls `delete_workspace_with_audit`, and the RPC locks the workspace, checks the paid-subscription guard, writes a minimal organization-level audit receipt, and deletes the workspace plus cascading database rows in one transaction. Before either a workspace or organization row can be deleted, a database trigger refuses the operation if any related private source lacks a confirmed object-deletion receipt. The user removes sources from Imports and waits for verified cleanup before retrying deletion.

## Verification

`tests/security/rls.pgtap.sql` creates two organizations plus an internal admin and validates isolation, role checks, private storage visibility, capacity reservations, workspace lifecycle RPCs, cross-file canonical deduplication, explicit decision atomicity, payer-mapping authorization, canonical latest-run state, audit actor and source linkage, copied match evidence, export history, public form scope, and admin separation. It runs in a transaction and rolls back fixtures.

Database tests cannot prove browser secret exposure, webhook verification, provider-side signed-token behavior, or route rate limiting. API tests, bundle and log secret scans, and staging checks complement pgTAP coverage. The async migration tests verify tenant isolation, exact immutable paths, service-only worker functions, stale-lease recovery, capability-safe deletion, deletion receipts, and tenant-deletion fences. Production validation must also exercise real signed uploads and Storage deletion retries.
