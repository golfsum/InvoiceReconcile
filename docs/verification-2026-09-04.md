# Live customer verification, September 4, 2026

Target: https://invoicereconcile.com and Supabase project `ajhfuduvxuemjloepfra`.
Only fictional QA records and Stripe sandbox payments were used. Existing customer workspaces were not changed.

## Repairs shipped

- Provisioned the missing Upstash Redis dependency on its free plan with automatic paid upgrades disabled. Connected the production and preview rate-limit configuration without weakening fail-closed protection.
- Verified and configured a working server credential for the new Supabase project.
- Applied the two previously committed but unapplied reconciliation migrations, followed by `20260904000100_repair_runtime_sql.sql`.
- Repaired PostgreSQL's unsupported `jsonb_object_length` call, a shadowed JSON value in invoice balance reads, and composite row selections in four rule update/delete functions. Live database lint now returns no errors for `public` and `app_private`.
- Stopped presenting an email-service rejection as successful account creation. Confirmation and password-reset email outages now return retry messages.
- Moved dismissible notifications to the top center so they do not cover reconciliation controls.
- Exposed Matching rules in real-workspace navigation. Its server-side plan gates remain enforced.
- Enabled switching among Solo, Business, and Bookkeeper in the existing Stripe sandbox customer portal. Its existing no-proration setting was preserved.

## Live evidence

| Journey | Result |
| --- | --- |
| Signup | Submitted the actual signup form, reached the success page, and verified the new unconfirmed account in Supabase. |
| Confirmation caveat | The dedicated QA account was confirmed through the admin API to continue testing. Inbox delivery and clicking an emailed callback were not verified. No real customer's confirmation state was changed. |
| Sign-in and onboarding | Signed in through the form and created Cedar Grove Design QA with USD, Phoenix timezone, and accrual defaults. |
| Signed-in samples | Loaded 30 invoices and 22 payment rows; saved 21 accepted payments and 19 proposed matches. |
| Review decision | Confirmed the fictional Copper State partial payment. Invoice NS-2026-1007 persisted a $2,500 balance and `partially_paid` status. |
| Actual private uploads | Uploaded the Cedar Grove CSV fixtures and generated XLSX equivalents through the file inputs, including mobile. Private storage, background preview, mapping confirmation, queuing, and reconciliation completed. |
| Background persistence | Left Imports while the run was queued. The completed four-payment run subsequently appeared in the workspace and exports. |
| Repeat imports | Repeated the same private uploads on desktop and mobile. The database retained 34 canonical invoices, 25 canonical payments, and 25 billed payments across the sample and custom data. |
| Downloads | Downloaded CSV and XLSX through the UI. Parsed both and verified the expected fictional invoice and payer data. |
| Saved pages | Reloaded invoices, payments, exceptions, audit, settings, and exports successfully. |
| Free to Business | Completed the $49 test checkout after verifying `livemode: false`. The Stripe webhook saved an active Business subscription. |
| Feature unlocking | Custom rules were locked on Free and unlocked on Business. Created, edited, and deleted a rule through the UI. |
| Paid plan changes | Switched Business to Bookkeeper, then Solo in the Stripe portal. Verified subscription changes in Supabase and custom-rule relocking on Solo. |
| Quotas | Solo rejected a 501-payment reservation at its 500 limit. After cancellation, Free rejected 51 at its 50 limit. These denied checks did not create usage reservations. |
| Cancellation | Portal scheduled cancellation at the period end (`cancel_at`, confirmed in Stripe's event). Then immediately canceled the QA-only sandbox subscription through the API for cleanup. The webhook restored Free entitlements. |
| Payer mappings | Created, edited, and deleted a mapping on the QA workspace. |
| Multiple workspaces | Created a second fictional client, changed its matching window, then deleted that empty test workspace through its UI. |
| Public site | Verified sitemap routes, demo interactions, public forms, and desktop/mobile automated accessibility. The contact-form browser test intercepts delivery and is not an email-delivery test. |
| Admin security | Anonymous `/admin` redirects to sign-in. Production `/dev/admin` returns 404. |

## Automated checks and reproduction

- Lint, TypeScript, and production build passed.
- 346 unit/integration/security tests passed with `npm run test -- --maxWorkers=4`. An earlier fully parallel run hit a five-second import timeout; the focused test and bounded-worker suite passed.
- The complete live browser suite passed 29 tests with one redundant mobile sitemap test skipped. A subsequent targeted mobile XLSX import test also passed.
- `tests/e2e/live-customer-verification.spec.ts` provides opt-in real-account desktop/mobile checks for saved views, navigation, actual CSV/XLSX downloads, private uploads, and repeat reconciliation.
- Supply `PLAYWRIGHT_BASE_URL`, `LIVE_QA_EMAIL`, `LIVE_QA_PASSWORD`, and `LIVE_QA_WORKSPACE_ID` only in the environment. The email must start with `qa-`. Seed the workspace using the committed Cedar Grove fixtures. Never supply an actual customer account.
- A post-fix sample of 200 recent production requests contained no logged application errors or HTTP 5xx responses. This is a bounded sample, not a guarantee about every historical request.

## Remaining limits

- Confirmation, password-reset, contact, import-status, and invitation email delivery are not end-to-end verified. No Postmark token was configured in the application's Vercel environment at verification time. Supabase auth SMTP is a separate configuration and its inbox delivery still needs verification.
- No real-money purchase was performed. All three price IDs and the actual checkout were verified as Stripe test mode.
- QuickBooks, Xero, bank, and other external accounting connections were not exercised. The current product displays these as not connected.
- Original private-source deletion is scheduled after upload capabilities expire; this audit did not wait for every one-hour cleanup deadline. The isolated QA workspace remains available for inspection, with no active Stripe subscription.
- Existing unrelated local migration-renaming and documentation edits were preserved, not included in these commits.

This verifies the listed customer paths. It is not a claim that all possible inputs, email delivery, or third-party outages have been tested.
