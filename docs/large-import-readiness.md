# Large import readiness

Updated: 2026-08-23

## Release state

InvoiceReconcile now has two truthful import paths:

- CSV and XLSX files up to 2 MiB can use the authenticated synchronous request path. Demo files stay browser-local.
- Live-workspace CSV and XLSX files up to 50 MiB use a private, durable background workflow. The browser uploads directly with byte progress, remains responsive, and can leave the page while validation, preview generation, matching, persistence, notification, and cleanup continue.

The background path is implemented in migration 017, authenticated import routes, and Workflow DevKit workflows. It must be deployed with the migration, private bucket, service credentials, and Workflow DevKit configuration before production traffic is enabled.

## Durable contract

`import_source_uploads` records an immutable source intent bound to the authenticated actor, organization, workspace, import kind, expected byte count, canonical MIME type, SHA-256 digest, random nonce, and exact server-derived private object path. `async_reconciliation_requests` binds two ready sources, confirmed mappings, submitter, rule context, progress, worker lease, and result pointer. `user_notifications` stores privacy-safe, idempotent ready and failed notices.

The browser never selects a storage path or supplies worker identity. Initialization and finalization recheck active editor membership and current plan capacity. The worker claim rechecks actor access, subscription status, and source payment count. The final persistence transaction performs the authoritative concurrency-safe capacity reservation.

Workflow DevKit provides durable step retries without serializing financial rows between workflow steps. Download, byte validation, parsing, normalization, matching, and transactional persistence stay inside one Node step. Jobs and error summaries contain identifiers and bounded safe codes only.

## Upload and validation

The server mints a signed upload capability only for the exact bucket and immutable path recorded in the intent. Upload uses `upsert: false`. Supabase signed upload tokens may remain valid for two hours, so every issuance records a conservative capability-safe deletion time of two hours and five minutes. No cleanup or deletion-confirmation RPC can remove the object before that time.

The worker downloads only the bucket and path from the immutable intent, then recomputes the actual byte count and SHA-256 digest. It validates the file signature rather than trusting the name or browser MIME value. CSV decoding, XLSX actual decompression, sheet count, worksheet dimensions, row count, header count and length, row width, individual cell length, and total parsed characters are bounded before normalization and matching.

The XLSX preflight inflates every archive member with a 64 MiB total actual-output ceiling before ExcelJS loads the workbook. ExcelJS still materializes a workbook within that bounded expansion. Isolated worker-memory load testing against hostile but valid 64 MiB workbooks remains a staged P2 hardening item.

## Processing, progress, and saved results

The user sees upload, validation, preview, queue, matching, persistence, ready, and failed states through accessible progress elements. Preview and reconciliation claims use random step tokens, hashed compare-and-set leases, expiry, and idempotent run keys. Expired claims can be reclaimed; membership or entitlement changes fail closed.

Matching uses bounded deterministic candidate indexes and preserves evidence for human review. A large run is saved transactionally and materialized into `reconciliation_run_read_items`. Workspace summaries read a compact overview, while invoice, payment, and exception screens request at most 50 items per page. Search, filter, keyboard review, and alternate-invoice lookup also use bounded server pages. Bulk approval applies only to the visible page. Server-side CSV and XLSX export pages through the read model instead of returning a complete snapshot to the browser.

## Notifications

Ready and terminal-failure events create one privacy-safe in-app notification for the submitter. The workspace shell reads at most 20 notices and supports unread and read state. Best-effort Postmark delivery occurs only after the durable database commit, contains no financial values, file names, customer or payer details, raw rows, signed URLs, or tokens, and cannot roll back a completed reconciliation. Each user can disable background-import ready and failed emails in Settings while in-app progress and notifications remain available.

## Retention and verified deletion

Synchronous files up to 2 MiB are processed in request memory without a deliberate application-storage copy. Structured import rows remain Customer Content.

Background sources are held temporarily in the private `import-source-files` bucket. Processing success, permanent preview failure, a user removal request, or retention expiry transitions the source to durable deletion-pending state. Cleanup waits until every signed upload capability has expired, removes only the exact stored path, and records `object_deleted_at` only after Storage confirms success. Provider failures increment bounded safe telemetry and remain pending for recurring workflow retries.

Every source has a 24-hour lifecycle that schedules cleanup and recovers stale preview or reconciliation leases. The 24-hour mark is the cleanup schedule, not a false claim that an unavailable storage provider has already deleted bytes. Workspace and organization deletion are fenced until every related private object has a confirmed deletion receipt, preventing database cascades from orphaning source files.

## Verification matrix

Release verification covers:

- tenant isolation for source initialization, status, finalization, requeue, enqueue, notification, read-item, and deletion operations;
- viewer denial and service-only worker, claim, cleanup, and persistence RPCs;
- exact immutable signed paths, non-overwrite uploads, capability-safe deletion, and verified deletion receipts;
- actual byte, digest, signature, XLSX expansion, worksheet, row, header, width, cell, and parsed-character bounds;
- saved compatible mapping reuse only when every mapped header exists;
- enqueue, worker-claim, and commit entitlement gates;
- lease expiry, idempotent retry, revoked membership, terminal failure, and ready notification behavior;
- matching parity for payer mappings and entitled custom rules, including both rule fingerprints in run identity;
- bounded rendering and server paging for 10,000-row runs; and
- tenant-deletion fences and durable cleanup after user-requested removal.

Production rollout must also exercise a real Supabase signed upload, storage deletion outage recovery, Postmark delivery and opt-out, and representative 10,000-payment timing and memory on the selected worker plan.
