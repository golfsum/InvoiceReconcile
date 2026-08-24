# Production service integrations

## Operating contract

This layer keeps external services behind typed, server-only adapters. Missing credentials never produce a fake successful connection, checkout, email, or database write. Development mode can accept an explicitly labeled local demo result where a real external side effect is not possible. Production returns a useful unavailable response so the caller can retry without losing data.

Secrets are read only in server modules. API responses, structured logs, analytics properties, and integration state objects never include service-role keys, Stripe secrets, Postmark tokens, OAuth secrets, payment amounts, invoice details, customer names, or contact-form content.

## Billing

The application exposes:

- `POST /api/billing/checkout` for authenticated organization owners and admins
- `POST /api/billing/portal` for authenticated organization owners and admins
- `POST /api/webhooks/stripe` for signed Stripe events

Checkout accepts `plan`, an optional `organizationId`, and an optional same-site `returnTo` path. The organization is resolved from the authenticated user's active membership. The browser cannot submit an arbitrary Stripe customer ID. If a user administers more than one organization, the request must name an organization they administer.

The monthly billing contract is:

| Plan | Amount | Environment variable |
| --- | ---: | --- |
| Solo | $19.00 | `STRIPE_PRICE_SOLO` |
| Business | $49.00 | `STRIPE_PRICE_BUSINESS` |
| Bookkeeper | $99.00 | `STRIPE_PRICE_BOOKKEEPER` |

Before starting Checkout, the server retrieves the configured Stripe Price and verifies that it is active, monthly, in USD, and equal to the displayed amount. A misconfigured price is unavailable instead of charging the wrong amount. Production Stripe IDs are never hardcoded.

Clients should send a stable `Idempotency-Key` header when starting Checkout. The accepted format is 8 to 200 letters, numbers, colons, underscores, or hyphens. Stripe uses that key to deduplicate a retried session request.

The webhook reads the raw request body and validates `stripe-signature` before any database operation. It synchronizes these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Subscription writes use an organization-scoped upsert. Replaying the same verified event produces the same subscription state. Stripe remains the billing source of truth. A database outage returns a retryable error to Stripe instead of acknowledging a dropped update.

Required billing configuration:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_SOLO`
- `STRIPE_PRICE_BUSINESS`
- `STRIPE_PRICE_BOOKKEEPER`
- `NEXT_PUBLIC_APP_URL`
- Supabase URL and service-role key for webhook persistence

Create the webhook endpoint in Stripe with the four event types above. Use Stripe test mode for previews and development. Do not mix live price IDs with a test secret key.

## Transactional email and contact

`POST /api/contact` validates and bounds every field, checks a honeypot, enforces per-address and per-email rate limits, and HTML-escapes submitted content before email rendering. It stores a `contact_requests` record through Supabase when configured and sends through Postmark when configured.

The support notification goes to `support@invoicereconcile.com`. The submitter receives a short receipt with a request reference. Email open tracking is disabled. Logs include the random request reference and delivery state, but not the submitter's name, email address, subject, or message.

Production accepts the request only when it was stored or the support notification was delivered. Local development without Supabase and Postmark returns an explicitly local demo acceptance so the form can be exercised. Production never reports a dropped message as successful.

Required email configuration:

- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_MESSAGE_STREAM`, normally `outbound`
- `POSTMARK_FROM_EMAIL`, normally `support@invoicereconcile.com`

The sending domain must be verified in Postmark before using the production address.

## First-party analytics

`POST /api/analytics/events` accepts a small, strict event envelope and stores it in `analytics_events`. Anonymous events carry random anonymous and session UUIDs. Signed-in events use the authenticated Supabase user ID. The endpoint stores only a query-free path and the hostname portion of a referrer.

Supported funnel events include:

- `signup_started` and `signup_completed`
- `sample_demo_started`, `demo_started`, and `demo_completed`
- `invoice_imported`, `payment_imported`, `import_started`, and `import_completed`
- `exception_reviewed`, `review_opened`, `match_confirmed`, and `match_rejected`
- `reconciliation_completed` and `export_created`
- `pricing_viewed`, `checkout_started`, `checkout_completed`, and `subscription_started`
- `lump_sum_tool_used` and `tool_used`
- `page_view` and `contact_submitted`

Properties use a closed allowlist of short categorical fields. Arbitrary keys are rejected. Do not add amounts, invoice numbers, references, customer or payer names, descriptions, memos, email addresses, filenames, source rows, or other financial data. Add a new property only after updating the schema, database constraint, tests, and privacy review together.

Repeated event UUIDs are treated as successful duplicates. Analytics storage failures return an unavailable response. In development without Supabase, the endpoint returns `mode: "demo"` and does not claim persistence.

## Rate limiting

Upstash Redis provides distributed sliding-window limits in production. Development uses a bounded in-memory fallback so local flows remain testable. The fallback prunes expired buckets and caps memory growth.

Required production configuration:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If these values are absent in production, protected mutation endpoints fail closed. Keys contain a one-way, truncated request-address digest instead of a raw IP address. Contact email limits also use a one-way digest.

Current boundaries:

| Boundary | Limit |
| --- | ---: |
| Contact address | 5 per hour |
| Contact email | 3 per hour |
| Analytics visitor and address | 120 per minute |
| Checkout address | 20 per 5 minutes |
| Billing portal address | 20 per 5 minutes |

## Accounting and payment-source adapters

Typed connection-state adapters exist for QuickBooks Online, Xero, Plaid, Stripe, and Square. Each adapter declares its capabilities and required server configuration. Database connection records are read through organization RLS. A provider with no record always reports `disconnected`. Configured credentials indicate setup readiness only and never change connection status.

The current state layer intentionally reports the connection flow as `not_configured` or `not_implemented`. No provider is shown as connected until a real OAuth or token flow succeeds and a persisted integration record says so. OAuth tokens must live in a managed encrypted secret store referenced by `secret_reference`; they must not be stored in the integration `configuration` JSON.

Provider setup variables reserved by the adapters are:

- QuickBooks: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`
- Xero: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`
- Plaid: `PLAID_CLIENT_ID`, `PLAID_SECRET`
- Stripe Connect: `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_SECRET_KEY`
- Square: `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`

## Verification performed

Focused tests cover exact price mapping, remote price contract validation, analytics privacy rejection, connection-state honesty, contact HTML escaping, and valid and invalid Stripe webhook signatures. The owned service paths pass TypeScript and ESLint checks.

Live Checkout, portal, delivery, webhook persistence, and provider OAuth still require sandbox credentials and external service provisioning. They should be verified in the preview environment before production launch. No external resources were provisioned by this implementation.
