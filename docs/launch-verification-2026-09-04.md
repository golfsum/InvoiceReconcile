# Production launch verification, 4 September 2026

Outcome: the tested signup-to-reconciliation journey works in production, and sandbox billing lifecycle changes reach saved application access. Live paid launch is **not yet approved**. Stripe remains in test mode. This follow-up supersedes the unverified signup/reset and basic sandbox-flow items in [the earlier readiness report](live-billing-readiness-2026-09-04.md), not its live cutover requirements.

## Production change

Commit `1914c83` was deployed as `dpl_AC5eorr4emMKA9DSpwV7kjGG7NwJ`, verified READY and aliased to `invoicereconcile.com`.

- Billing now reads the authenticated organization's saved subscription, showing current plan, payment limit, status, payment-recovery guidance and scheduled cancellation date.
- Paid customers use the portal for changes instead of being offered duplicate checkout buttons. A checkout return URL alone does not grant access or prove payment.
- Failed or unauthorized billing reads do not silently report Free or allow checkout. Membership resolution and row-level security remain in place. Provider customer IDs are not sent to the client.
- Known migration/admin/organization errors give safe recovery instructions. Unknown provider errors stay private.
- Production configuration validation rejects redacted `[SENSITIVE]` exports as evidence of working credentials.
- Opt-in browser tests cover private CSV/XLSX uploads, reconciliation, actual export downloads and the billing summary on desktop and mobile.

Next.js server-side data guidance kept subscription reads behind authenticated server boundaries. The React review kept provider records out of client props and avoided unnecessary browser-side fetching.

## Verified customer journey

All writes used a newly created fictional QA account at the owner's `contact@` inbox, with workspace **Harbor Field Services QA**. No existing customer accounting data or the owner's personal password was changed.

| Boundary | Observed result |
| --- | --- |
| Signup | Actual production form reached the account-created success page. |
| Confirmation email | Postmark recorded delivery; the actual email link completed the callback and opened authenticated onboarding. |
| Onboarding sample link | Opened the fictional workspace; both sample files mapped and reconciliation opened the review queue. |
| New workspace | Business name and defaults saved; private Imports opened correctly. |
| Private file uploads | Desktop CSV and mobile XLSX each imported four fictional invoices and four payments, confirmed mappings and queued durable reconciliation. |
| Match results | Exact single-invoice match, combined-invoice match, partial-payment review and unmatched deposit appeared with supporting evidence. |
| Exports | Both browser runs downloaded CSV and XLSX, parsed the actual files and found the expected invoice reference. |
| Decision persistence | Confirmed the fictional $1,200 Aspen payment; a fresh Audit view showed the application and $0 remaining invoice balance. |
| Import emails | Four ready-to-map and two reconciliation-ready messages were recorded Delivered by Postmark. |
| Password recovery | Delivered reset email opened the actual reset page; QA-only password changed; sign-out and fresh sign-in with the new password succeeded. |
| Admin protection | The ordinary QA user was denied `/admin`; anonymous protection and production `/dev/admin` exclusion also passed automated checks. |
| Analytics | Consent-enabled production navigation returned `202` from `/api/analytics/events`, replacing the previously reported 503 behavior in this check. The previous rejected-consent choice was restored. |

Postmark delivery is provider acceptance evidence, not a claim that every mailbox places every message in its inbox. The user had previously confirmed receipt of the setup email at `contact@`. Support inbox/reply access still needs an owner check.

## Sandbox billing lifecycle

Only the new QA organization's subscription was changed. Every scripted Stripe mutation checked the test-key prefix, `livemode: false`, exact customer and organization metadata. No real card or charge was used.

1. Submitted Stripe-hosted sandbox Checkout with the documented 4242 test card for Business. Stripe reported the session complete/paid and subscription active. Team invitation controls unlocked in a freshly loaded workspace.
2. Changed Business to Bookkeeper through the customer portal. Production's saved summary showed Bookkeeper, active and 10,000 payments per month.
3. Scheduled cancellation through the portal. Stripe used `cancel_at` equal to the period end. The application correctly displayed the cancellation date while retaining paid access.
4. Cleared that QA cancellation and attached Stripe's documented decline-after-attachment test payment method. Billing-anchor and short-trial probes did not generate a payable renewal invoice, so they are **not** counted as successful renewal tests.
5. Forced an invoiced sandbox plan update. The invoice remained open after a failed payment, Stripe changed to `past_due`, and production displayed the payment warning while retaining the documented grace-period access.
6. Restored the working test payment method and paid that specific sandbox invoice. Stripe reported paid/active; a refreshed application page returned to active.
7. Canceled only the QA subscription immediately without proration or another invoice. Production showed Free, 50 payments/month and canceled; colleague invitations and custom rules relocked. Fictional imports and audit history were retained.

This verifies real Stripe-delivered subscription-state propagation and payment recovery, not a natural monthly renewal, complete timed retry exhaustion, or a live payment. See [Stripe billing testing](https://docs.stripe.com/billing/testing) and [documented failure payment methods](https://docs.stripe.com/testing?testing-method=payment-methods).

## Automated verification

- Full unit/integration/security suite: **411 passed across 86 files**; intentional fault-injection logs belong to tests, not production failures.
- Production build, TypeScript, lint and copy checks passed.
- Public production suite after deployment: **34 passed, 2 intentionally skipped** duplicate mobile sitemap checks. Covers public routes, search metadata/canonicals, pricing calculator, demo workflow, legal/contact form shape, themes, admin protection and automated WCAG A/AA checks.
- Private upload/export suite: **2 passed**, desktop CSV and mobile XLSX, against production before the billing-only change.
- Authenticated billing refresh/accessibility suite after deployment: **2 passed**, desktop and mobile; no tested automated WCAG violations or horizontal overflow.
- Production error/fatal log scan over the final 30-minute window found no matching entries. This is a bounded scan, not a guarantee of zero errors under all workloads.

The public contact-form browser test mocks delivery. Actual production contact and support-topic delivery was verified separately in the earlier report. Browser coverage is Chromium desktop/mobile, not exhaustive cross-browser/device/load testing.

### Repeat private verification safely

`tests/e2e/launch-import-verification.spec.ts` skips unless all of these are explicitly supplied: `LAUNCH_QA_ENABLED=true`, `LAUNCH_QA_EMAIL`, `LAUNCH_QA_PASSWORD`, and `LAUNCH_QA_WORKSPACE_ID`. Set `PLAYWRIGHT_BASE_URL=https://invoicereconcile.com` only when intentionally testing production. Never point the upload test at a customer's workspace. The write test additionally verifies the selected workspace has the exact fictional QA name.

Credentials remained in memory and process environment. No passwords, SMTP keys, email authentication links or exported secrets were added to the repository. The temporary redacted environment export was removed, and an accidental test-created Windows cache folder was moved out of the repository to a recoverable temporary folder.

## Remaining live-launch gates

1. Verify live Stripe account activation, live keys/prices, live customer portal, webhook signing secret and a Stripe-delivered live event. None were switched on during QA.
2. Confirm preview deployments use a separate sandbox database and billing configuration. Live-mode guards alone do not isolate shared data.
3. Back up and approve a scoped migration of existing sandbox billing identities/entitlements before switching production to live keys. Freeze checkout and drain old pending sessions first. Do not delete accounting data or broadly replace customers.
4. Exercise a timed renewal/retry sequence through its terminal unpaid/canceled state, confirming the configured grace policy and access downgrade. The successful forced-payment-failure/recovery test above does not replace this.
5. Confirm access to support replies and review operational monitoring/backup-restore readiness. Team invitation acceptance, exhaustive multi-user isolation, large-file/load testing and all browsers were not newly proven in this pass.
6. After explicit approval for a real payment, perform one live checkout, verify saved entitlement/feature unlock, and test portal management and cancellation. Do not assume a refund is authorized.

The available `.env.local` still targets an obsolete Supabase project. Do not use it for production database operations. Vercel's environment runner loaded that local overlay during inspection, and sensitive production exports were redacted. Those attempts were rejected as production-readiness evidence; deployed behavior and scoped provider reads supplied the verification above.
