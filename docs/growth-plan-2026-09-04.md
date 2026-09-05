# Acquisition and subscription plan

## Positioning decision

Start with independent bookkeepers and small bookkeeping practices handling recurring, mixed-source invoice and bank exports. Their job is to explain incoming cash, handle grouped or partial payments, and hand off a reviewable record without changing accounting systems.

This is a positioning hypothesis, not proof of demand. Native QuickBooks and Xero already offer matching. A generic claim to automate reconciliation is not a sufficient reason to buy another tool. Focus on the awkward file-based work that remains after native matching, with a self-service sample and transparent limits.

## Implemented in this change

- Search-focused homepage title and description with aligned social metadata.
- Explicit 50-payment monthly free offer, no-card signup, and no-signup demo.
- Homepage sample uses the real Northstar fixture counts and example identities. No fabricated match-rate or popularity claims.
- Clear CSV/XLSX workflow and explicit lack of automatic accounting write-back.
- Direct links to useful file-format samples and audience workflows.
- Pricing chooser recommends the least expensive published plan covering payment volume, client workspaces, and advanced feature needs. It refuses unsupported volumes and never grants entitlements.
- Comparison includes colleague invitations and custom rules. Paid plan selection still proceeds to account setup and explicit checkout, not an immediate charge.
- Contextual free-workspace CTA on 14 topic pages; existing samples remain downloadable without an email gate.
- Four duplicate search titles corrected across solution and industry pages. No mass-generated pages or keyword-stuffed clones added.
- Accurate last-modified dates on changed search content, crawl regression tests, and retained private-route exclusions.
- Privacy-choice control moved into document flow to avoid covering mobile CTAs. Consent requirements unchanged.
- Narration button accessible name now includes visible text; audio downloads deferred until requested.

These changes are implemented and tested locally. They are not a production deployment.

## Launch gates before spending on acquisition

1. Verify signup confirmation and password reset using a real inbox. Previous QA manually confirmed a fictional account, which does not prove delivery.
2. Configure and verify application email delivery for contact requests, invitations, and notifications. Previous live verification found Postmark unconfigured.
3. Explicitly authorize the move from Stripe sandbox to live billing. Validate live price IDs, signing secret, webhook processing, customer portal, cancellation, and entitlements. Do not reuse test customers or claim sandbox revenue.
4. Deploy these changes after approval, repeat the public crawl and funnel tests against the production domain, then inspect Search Console.
5. Verify domain ownership in Google Search Console and Bing Webmaster Tools, submit the sitemap, inspect the homepage and the three priority landing pages, and monitor actual indexing. A sitemap response is not proof of indexing. Do not publish credentials in source.

## First two weeks: learn and activate

- Invite a small, targeted pilot group of bookkeepers through existing relationships and individually relevant outreach. Suggested learning target: ten conversations, not a forecast or guaranteed number of users. No bulk unsolicited campaign.
- Offer a short guided reconciliation using fictional data first, then a customer-controlled export. Never ask prospects to email unredacted financial files.
- Send prospects to the relevant scenario, not just the homepage: one payment covering multiple invoices, Excel workflow, or multi-client bookkeeping.
- Ask where their current accounting system stops helping. If native matching already solves the job, do not force an additional subscription.
- Observe five complete first-use sessions. Record where verification, column mapping, matching, confirmation, or export creates friction. Prioritize those fixes over more page production.
- With explicit permission, develop the first real case study. Publish measured before/after work and limitations, not invented time savings, logos, or testimonials.

## Search priorities: build useful evidence

| Intent | Existing page to strengthen | Next original asset |
| --- | --- | --- |
| One payment covers several invoices | `/combined-payment-invoice-matching` | An annotated real-product walkthrough using the public fictional CSV pair |
| Reconcile Excel invoice and bank exports | `/excel-invoice-reconciliation` | Source-column troubleshooting based on pilot imports |
| Bookkeeping across client systems | `/solutions/bookkeepers` | A permissioned case study of a recurring multi-client close |

Keep guides, solution pages, and industry pages only while they answer distinct questions. Track query overlap and canonical selection before consolidating established URLs. Do not add city pages or near-identical keyword variants. Earn relevant links through useful tools, templates, demonstrations, and genuine partnerships. No purchased ranking links.

## Measurement and subscription growth

Primary activation: a new verified organization completes its first real reconciliation and exports a confirmed result. A demo visit or signup alone is not activation.

Track the existing consent-aware events from landing visit to signup, imports, reconciliation completion, export, checkout, and subscription start. Exclude QA accounts and sandbox subscriptions. Consent refusal creates an intentional measurement gap; do not work around it with hidden tracking.

Review weekly cohorts: signup-to-activation rate, median time to first confirmed export, activation-to-paid conversion, second-cycle return rate, failed verification/import rate, and cancellation reasons. No credible baseline or uplift claim is available yet. Establish one before changing price or buying ads.

If customers activate but do not subscribe, inspect actual monthly usage and demand for workspaces/rules before adding pressure to upgrade. If they sign up but never activate, fix onboarding before driving more traffic. Ads are an optional later experiment with an approved budget and stop rule, not part of this change.

## Sources checked September 4, 2026

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide): technical accessibility and useful content help; changes can take hours to months, and ranking/indexing is not guaranteed.
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies): avoid doorway/scaled low-value content and ranking manipulation.
- [QuickBooks transaction matching](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US): native bank matching is an existing alternative.
- [Xero bank reconciliation](https://www.xero.com/us/accounting-software/reconcile-bank-transactions/): native matching and automated workflows exist; InvoiceReconcile's narrower export-based positioning is an inference, not a claim of unique functionality.

SEO is a compounding acquisition channel, not a guaranteed fast-user switch. Direct pilot recruitment plus a demonstrably useful first reconciliation is the near-term recommendation.
