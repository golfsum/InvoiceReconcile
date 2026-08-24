# InvoiceReconcile

InvoiceReconcile is an incoming-payment reconciliation SaaS for bookkeepers, accounting firms, and small finance teams. It imports open invoices and payment files, proposes traceable matches, routes uncertain cases to a review queue, and exports confirmed results.

The workflow is deliberately narrow:

`Import → Match → Review exceptions → Confirm → Export`

## Local setup

Requirements:

- Node.js 20 or newer
- npm
- Optional Supabase project for live accounts and persistence
- Optional Stripe test account for checkout
- Optional Postmark server for email delivery
- Upstash Redis database for production rate limiting

Install and start:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

The terminal prints the local development URL. A public fictional workspace remains available without third-party credentials.

## Production configuration

1. Create a Supabase project and apply the SQL files in `supabase/migrations` in version order.
2. Set the public Supabase URL and anonymous key. Keep the service-role key server-only.
3. Create three monthly Stripe Prices matching Solo $19, Business $49, and Bookkeeper $99. Set their IDs and the signed webhook secret.
4. Verify the sending domain in Postmark and configure `support@invoicereconcile.com` as the sender.
5. Configure Upstash before a production deployment. Mutation endpoints fail closed when distributed rate limiting is unavailable.
6. Set the legal entity, business address, governing law, and court venue values after counsel review.
7. Set `ADMIN_EMAILS` and mark internal operators in `profiles.is_internal_admin`.
8. Run `npm run check:env` against the production environment before deploying. It validates required Supabase, Upstash, live Stripe, Postmark, legal-operator, demo, and analytics settings without printing their values.

See [.env.example](.env.example), [integration setup](docs/integrations.md), and [data architecture](docs/data-architecture.md) for the complete contract.

Local development and tests do not invoke the production validator automatically. A production demo remains optional; when enabled, it requires a dedicated secret of at least 32 characters.

## Verification

Run the local code checks with:

```powershell
npm run check
```

With production environment values loaded and the application available to Playwright, run the complete release gate:

```powershell
npm run check:release
```

`check:release` validates production configuration, runs copy, lint, type, unit, and build checks, then runs the end-to-end suite.

The unit suite covers matching, imports, admin aggregation, SEO tools, Stripe validation and signatures, email safety, analytics privacy, and integration state honesty. PostgreSQL RLS assertions live in `tests/security` and require a running Supabase test database.

## Key modules

- `src/lib/reconciliation`: deterministic matching and evidence generation
- `src/lib/imports`: CSV/XLSX parsing, mapping, normalization, and duplicate detection
- `src/components/app`: import, review, audit, export, rules, and workspace interfaces
- `src/lib/admin`: signup, MRR, traffic, activation, retention, and operations reporting
- `src/lib/billing`, `src/lib/email`, `src/lib/analytics`: production service adapters
- `supabase/migrations`: normalized tenancy, reconciliation, operations, analytics, billing, and private storage schema

InvoiceReconcile suggests matches. Users remain responsible for reviewing records before posting or relying on them.
