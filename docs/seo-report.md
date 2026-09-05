# InvoiceReconcile public search and acquisition report

## Scope

This route layer is intentionally narrow and useful. It contains 14 core topic pages, 3 solution pages, 7 industry pages, 1 fair comparison, 10 educational resources, and 5 working browser tools. It does not create location combinations or other mass-produced programmatic pages.

All pages use the existing InvoiceReconcile marketing frame and neutral financial-operations design system. The pages avoid fake logos, testimonials, usage counts, certifications, customer claims, and invented benchmarks. Every public route has a distinct title, description, canonical URL, and server-rendered body.

## Core topic pages

- `/invoice-reconciliation-software`
- `/payment-reconciliation-software`
- `/invoice-payment-matching`
- `/accounts-receivable-reconciliation`
- `/cash-application-automation`
- `/bank-deposit-to-invoice-matching`
- `/combined-payment-invoice-matching`
- `/partial-payment-reconciliation`
- `/quickbooks-invoice-reconciliation`
- `/quickbooks-payment-matching`
- `/excel-invoice-reconciliation`
- `/invoice-reconciliation-for-bookkeepers`
- `/payment-reconciliation-for-accounting-firms`
- `/payment-reconciliation-for-small-business`

The accounts receivable page explicitly distinguishes incoming customer payment matching from accounts payable. QuickBooks pages position InvoiceReconcile as a preparation and exception layer, not a replacement accounting system.

## Audience pages

Solutions:

- Bookkeepers
- Accounting firms
- Small businesses

Industries:

- Accounting firms
- Bookkeepers
- Consulting
- Marketing agencies
- Home services
- Wholesale distribution
- B2B services

Each audience page has distinct source patterns, payment relationships, risk points, and examples. They are not industry-name substitutions over identical copy.

## Educational resources

The resource library covers the 10 requested launch topics. Articles use procedures, formulas, controls, worked examples, and lists only where they improve comprehension. Article structured data identifies InvoiceReconcile as the organizational author and publisher. Breadcrumb structured data matches visible breadcrumbs.

No FAQ structured data is emitted. Google currently limits FAQ rich results primarily to well-known government and health sites, so adding it to a financial software marketing site would not be useful. The visible content can still answer questions without inapplicable markup.

## Working tools

- Lump-sum invoice matcher: bounded subset search over integer cents, maximum 20 invoice candidates and 12 displayed results
- Invoice payment matcher: identifies only amount values that appear once on both sides and separates ambiguous repeats
- Reconciliation time calculator: calculates current manual hours and labor cost without presenting the result as guaranteed savings
- Partial payment allocation calculator: applies one payment in explicit row order and shows applied, remaining, and unapplied amounts
- Invoice reference cleaner: normalizes common labels, punctuation, spacing, and case while warning users to retain source values

All calculations run in the browser. The tools state their limits and do not claim that mathematical equality proves a financial match.

## Structured data and metadata

- Canonical metadata is generated from `NEXT_PUBLIC_APP_URL` with `https://invoicereconcile.com` as the production default.
- Open Graph and Twitter summary metadata use the same route-specific title and description.
- BreadcrumbList markup is included where a visible breadcrumb exists.
- SoftwareApplication markup appears on core product-topic pages with a free-plan offer only. No review or rating data is invented.
- Article markup is limited to the educational resource pages.

## Current product-source verification

QuickBooks language was checked against official Intuit documentation on August 23, 2026:

- [Match your bank and credit card transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US)
- [Automatically match QuickBooks Online product transactions](https://quickbooks.intuit.com/learn-support/en-us/help-article/payment-processing/automatic-matching-quickbooks-payments/L3EydeQEU_US_en_US)

The pages state that QuickBooks Online supports suggested matching for downloaded bank transactions and automatic matching for eligible QuickBooks product transactions. They also state that feature availability and product behavior can change, recommend checking current Intuit guidance, and avoid claiming that QuickBooks cannot reconcile transactions.

## Internal linking model

Core topic pages link to one adjacent commercial topic, one educational guide, and one working tool where relevant. Articles link to three closely related resources and the sample workspace. Audience pages link to the most relevant topic page, guide, or calculator. Descriptive anchor text is used throughout.

## Verification

Scoped tests cover:

- the exact core, solution, industry, and resource inventories
- distinct article slugs and titles
- prohibited copy patterns
- currency parsing and fixed-cent arithmetic
- bounded combination search
- unique exact-match behavior
- partial allocation and overpayment behavior
- manual time calculations
- invoice reference normalization

Run:

```text
npx vitest run tests/seo
npx eslint "src/content/seo/**/*.{ts,tsx}" "src/app/(marketing)/resources/**/*.{ts,tsx}" "src/app/(marketing)/tools/**/*.{ts,tsx}" "src/app/(marketing)/solutions/**/*.{ts,tsx}" "src/app/(marketing)/industries/**/*.{ts,tsx}" "src/app/(marketing)/compare/**/*.{ts,tsx}"
npm run typecheck
```

The original route-track scope has since been integrated with the root sitemap and robots policy.

## September 4, 2026 growth audit

The local production-build crawl now covers all 51 sitemap URLs: HTTP 200, unique title and description, one canonical matching its sitemap URL, one H1, and no noindex directive. Four duplicate titles across solution/industry pages were found and corrected. Topic pages and audience pages retain distinct content; no new keyword variants were generated. The homepage has search-specific metadata and aligned Open Graph/Twitter text. Private routes remain outside the sitemap.

Homepage and pricing make the 50-payment monthly free offer explicit. Pricing now explains gated features, supports a volume/workspace/feature chooser, and preserves explicit checkout. Topic pages lead to the free workspace after their useful worked content. The CSV sample link now leads to a guide with actual downloadable files. Fictional examples are labeled and misleading popularity/match-rate claims removed.

`tests/e2e/growth-funnel.spec.ts` verifies the crawl and conversion links; `tests/seo/plan-recommendation.test.ts` verifies pricing boundaries. Local production browser tests verify signup plan preservation, sample exceptions, CSV downloads, demo narration and interactions, and pricing accessibility. The full test suite has 362 passing tests.

Production-build Lighthouse lab reports: mobile performance 95, desktop 100; SEO, accessibility and best practices 100 on both. These are synthetic local results, not field Core Web Vitals or ranking forecasts. The initial Windows CLI wrote complete reports but errored when deleting its temporary browser profile. Follow-up audits completed successfully against an already-running browser. Mobile LCP was 2.8 seconds and desktop 0.7 seconds. The audit also surfaced an accessible-name issue and unnecessary initial audio loading, both corrected.

No claim is made that Search Console is connected, pages are indexed, or production reflects this working tree. Deployment and real email/live billing verification remain gates. SoftwareApplication markup without reviews is not claimed to qualify for Google's software rich result; no fake rating or review was added.

See [the dated growth plan](growth-plan-2026-09-04.md) for current official sources, the buyer hypothesis, pilot recruitment, priority intent pages, and consent-aware activation metrics. Earlier statements in this document about unique metadata describe the intended baseline; this audit provides the actual regression evidence.
