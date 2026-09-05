# Live billing readiness, 4 September 2026

Follow-up: [production launch verification](launch-verification-2026-09-04.md) records completed signup/reset, private imports and sandbox payment recovery checks after this initial pass. Live cutover is still gated.

Status: not approved for live charges. Stripe remains in sandbox mode. Billing safeguards and email routing were deployed to production through commits `3e8df0e` and `29dee4f`. Deployment `dpl_AHaG1uwvEmyZ21LN7N9m8rAmSjqg` was verified READY and aliased to `invoicereconcile.com`. Postmark sending-domain verification, Vercel production email secrets and Supabase SMTP settings were configured with approval. No Stripe customers, subscriptions or accounting records were changed in this pass.

## Implemented safeguards

- Live keys require explicit `STRIPE_BILLING_MODE=live`. The default remains `test`.
- Secret and publishable keys must match the selected mode. Live mode is blocked in Vercel preview and development deployments.
- Prices and returned Checkout URLs must belong to the configured mode. Monthly pricing rejects multi-month intervals.
- Signed webhooks from the wrong mode cannot write subscription state.
- Saved customers are verified against the current Stripe account before checkout and portal access. Missing legacy customers produce a support-directed error, not an automatic replacement subscription.
- Portal cancellation using `cancel_at` exactly at the current period end is reflected in the application.
- Malformed production URL settings return validation failures without throwing or printing their values.

These guards do not migrate sandbox records or isolate a shared database. Those remain cutover requirements.

## Repeatable read-only inspection

`npm run check:billing -- --project-ref=ajhfuduvxuemjloepfra`

The command inherits environment variables. It deliberately does not load `.env.local`. Supply reviewed target environment variables through a secure environment runner. For an explicitly selected local file:

```powershell
node --env-file=.env.production.local --conditions=react-server --import tsx scripts/check-billing-readiness.ts --project-ref=ajhfuduvxuemjloepfra
```

Do not commit that file. Vercel-sensitive values may not be exportable, so missing/redacted values are blockers, not successful checks. The current `.env.local` points to an older Supabase project and must not be used for production database changes.

The inspection reads account readiness, prices, endpoint events/API version, expanded portal settings, saved billing identities, active checkout intents and the Postmark stream. It never changes settings or charges a card. `automatedChecksPassed` does not mean email delivery, webhook signing-secret correctness or a live payment has been proven; separate manual gates are always reported.

## Verified in this pass

- 394 automated tests passed across 85 files, including separate general/support topic routing, wrong-mode events and Checkout URLs, incompatible customers, renewal status handling and scheduled cancellation.
- Production build, typecheck, lint and copy checks passed.
- Read-only calls using the available sandbox key verified all three monthly prices, the configured webhook events and pinned API version, and the default portal's plan changes, payment-method updates, invoice history and period-end cancellation.
- DNS MX records remain on Migadu. The user confirmed receipt of the application email setup test sent through Postmark to `contact@invoicereconcile.com`.

The sandbox account's charge/payout flags are not evidence that the corresponding live account is activated. No real renewal failure/recovery or live checkout was performed in this pass. Route tests exercise mocked provider/database boundaries and do not replace deployed end-to-end verification.

## Email configuration

Keep Migadu as the mailbox provider. Do not replace its MX records with Postmark records.

The supplied Postmark server `19806005` has an active transactional `invoicereconcile` stream. InvoiceReconcile DKIM and custom Return-Path are verified. These production-only settings were saved in Vercel:

| Setting | Value |
| --- | --- |
| `POSTMARK_SERVER_TOKEN` | Server API token, stored as a sensitive secret |
| `POSTMARK_MESSAGE_STREAM` | `invoicereconcile` |
| `POSTMARK_FROM_EMAIL` | `notifications@invoicereconcile.com` |
| `CONTACT_NOTIFICATION_EMAIL` | `contact@invoicereconcile.com` |

The stream's server may also serve AppsResolve. Do not rename it, rotate shared tokens or change its other streams. Select the InvoiceReconcile stream explicitly.

Supabase Auth custom SMTP was enabled and saved for project `ajhfuduvxuemjloepfra`: `smtp.postmarkapp.com`, port `587`, using a newly generated stream-specific SMTP Access Key and Secret Key for `invoicereconcile`. Email confirmation remains enabled. The production forgot-password form successfully sent a reset message through this stream, and Postmark recorded delivery to the user's Gmail address. Its actual Reply-To header was `support@`, with link/open tracking disabled. No password was changed. Fresh signup confirmation and completing the reset-link flow remain unverified. See [Postmark SMTP configuration](https://postmarkapp.com/developer/user-guide/send-email-with-smtp) and [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Automated messages use `notifications@` with a default Reply-To of `support@`. Only the explicit General enquiry contact-form topic and its acknowledgement replies use `contact@`. Product, account, billing, privacy, security, legal, omitted and unknown topics stay with `support@`. A Postmark sender signature also sets the notification sender's default Reply-To to `support@`. No notification inbox was created. Migadu MX, SPF, DKIM and DMARC were preserved. Support inbox/forwarding access remains a separate check.

The local application email sender passed a real Postmark delivery test, confirmed by the user. Production contact-form submissions were then tested for both General enquiry and Product or import help. Both displayed success; Postmark recorded delivery to `contact@` and `support@`, respectively, and their acknowledgements had the matching Reply-To addresses. Production logs confirmed the general request was stored and sent via Postmark. The two clearly marked setup-test contact records were retained. No error/fatal logs were found for the tested deployment in the 15-minute post-deployment scan. Application link/open tracking is disabled. AppsResolve settings and shared Postmark tokens were not rotated.

## Live cutover gates

1. Finish live Stripe account activation and provide live keys securely. Create the three matching live prices and a live portal configuration. Test and live objects are separate: see [Stripe's go-live checklist](https://docs.stripe.com/get-started/checklist/go-live).
2. Give preview deployments a separate sandbox database and sandbox Stripe configuration. Production and preview must not share billing state after launch.
3. Freeze new checkout during cutover. Let sandbox sessions expire, reconcile pending intents, and make a database backup. Review and archive only confirmed sandbox billing records, then reset those organizations' test entitlements and customer references through an approved, scoped migration. Preserve accounting data and audit history. Do not broadly delete organizations or subscriptions.
4. Run the readiness inspection with the intended live account and production database. Resolve incompatible or unverifiable records before opening checkout.
5. Configure the live webhook and its signing secret, scope production variables separately, and deploy. Verify Stripe-delivered events persist successfully. Do not treat the checkout success redirect as proof of payment.
6. Exercise sandbox renewal failure, retry/recovery and cancellation end to end, including persisted access limits. The current policy grants a `past_due` grace state; `unpaid` and canceled subscriptions lose paid access. Verify Stripe's retry settings actually reach the intended terminal state.
7. After explicit approval for a real payment, verify live checkout, persisted plan, feature unlock, portal management and cancellation. A refund requires its own clear authorization. Do not switch back to test keys after accepting real subscriptions without a migration plan.
