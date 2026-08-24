# InvoiceReconcile product contract

## Customer and problem

InvoiceReconcile serves bookkeepers, accounting firms, and small service businesses that receive customer payments outside their accounting system and still match deposits to open invoices in spreadsheets. The recurring job is to import open invoices and incoming payments, find responsible matches, review only the uncertain cases, confirm the result, and export an audit-ready record.

The falsifiable pain hypothesis is that teams handling at least dozens of external payments each month will trust a reconciliation-only product with a representative file when it reduces manual matching without hiding the evidence. This hypothesis is disproved if qualified users understand the workflow but will not upload sample or real data, or if they cannot complete a first reconciliation without help.

## Product promise

Stop matching invoice payments by hand. InvoiceReconcile handles the payments that do not match cleanly, including combined payments, partials, fee differences, payer name mismatches, and missing references. It suggests matches but never posts financial changes automatically.

## Primary journey

1. Create an account or enter the clearly labeled demo workspace.
2. Create a workspace or choose a bookkeeping client.
3. Import invoice and payment CSV or XLSX files, with preview and column mapping.
4. Run the deterministic matching engine.
5. Review exceptions with factual explanations and confirm or reject each suggestion.
6. Export the reconciliation result and audit history.

## Activation and time to value

- Activation event: first reconciliation completed with at least one confirmed match.
- Target: sample data reaches a useful result within 2 minutes and five primary actions.
- Real-file target: a mapped invoice file and payment file produce a review queue within 5 minutes for files under 5,000 rows.
- Track onboarding start, imports, first result, exception decisions, completion, elapsed activation time, and return usage without sending invoice values, customer names, memos, or references to analytics.

## Scope

Version one includes deterministic matching, CSV and XLSX imports, transparent explanations, exception review, learned aliases, multi-client overview, audit history, CSV and XLSX exports, sample data, plan-aware billing architecture, first-party product analytics, and a protected internal admin area.

Live QuickBooks, Xero, Plaid, Stripe, Postmark, and Supabase behavior activates only when valid credentials are configured. Local development provides a clearly labeled fictional demo and does not pretend an external integration is connected.

## Reliability and scaling targets

- 99.9 percent monthly availability target after launch monitoring is connected.
- p95 interactive API response under 800 ms outside file processing.
- Imports under 5,000 rows complete within 30 seconds; larger imports use an asynchronous job path.
- No silent row loss. Every rejected or duplicate row receives a reason.
- Reconciliation is idempotent by workspace, import fingerprint, and engine version.
- Tenant access is enforced by Supabase row-level security and repeated in server authorization checks.

## Pricing value metric

Pricing follows monthly payments processed and number of workspaces. These measure reconciliation volume while keeping review, exports, and matching quality available on every plan. Displayed plans are Free, Solo at $19, Business at $49, and Bookkeeper at $99. Checkout is enabled only when matching Stripe price identifiers are configured.

## Acceptance checks

- The sample workspace demonstrates exact, combined, partial, fee, duplicate, overpayment, and unmatched cases.
- A user can import, map, match, review, confirm, and export without a dead control.
- Admin access is server-enforced and displays signups, user history, visitors, funnel, product metrics, failures, feedback, subscriptions, and MRR without unnecessary financial values.
- Terms, privacy, security, and contact pages use support@invoicereconcile.com and make no unearned certification claims.
- The homepage demo is interactive, narrated on user request, captioned, and specific to the product workflow.
- Public pages are responsive, crawlable, correctly described, and linked to working conversion paths.
