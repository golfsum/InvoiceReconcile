# Visual coverage map

## Public product

- Homepage at 1440 by 1000, 1024 by 900, 390 by 844, and 360 by 800
- Homepage narrated demo in idle, playing, combined-match result, fee-review result, muted, and reduced-motion states
- Pricing, product, security, privacy, terms, and contact pages
- Free tool input, result, validation, and empty states
- Search landing page, industry page, solution page, resource index, resource article, and not found page
- Sign in and sign up in ready, validation, loading, unavailable-provider, and success states

## Reconciliation workspace

- Multi-client overview, workspace dashboard, invoice table, payment table, imports, exception queue, match detail, audit, exports, rules, and settings
- First run, sample data, populated, empty, loading, validation, failure, and degraded integration states
- Exact, high confidence, review, unmatched, partial, overpayment, possible fee, duplicate, and currency mismatch states
- Light, dark, and system theme modes
- Desktop at 1440 by 1000 and 1280 by 800, tablet at 1024 by 900, phone at 390 by 844 and 360 by 800

## Internal admin

- Overview, users, activity, revenue, acquisition, product, failures, feedback, and empty data states
- Seven-day, thirty-day, ninety-day, and all-time filters
- Search with results and no results
- Admin denied state and local demo label

For every scrollable capture, measure the rendered scroll height and viewport, capture from zero through the exact maximum scroll position, and keep overlap between adjacent frames.

## September 4 growth verification

`scripts/verify-marketing-visuals.mjs` measures and captures complete overlapping vertical sweeps of home, pricing, and the Excel guide. Viewports: 1440x1000 desktop, 375x667 small phone, 390x844 phone, 430x932 large phone, and 412x915 Android-sized viewport. It asserts no page-level horizontal overflow and the true final scroll position. These are browser emulations, not native device certification.

Initial run: 15 page/device combinations, 152 frames in a unique temporary output directory with coverage.json. First, intermediate and bottom images were reviewed. The initial sweep exposed the floating privacy control covering a small-phone CTA. It was moved into document flow and the sweep repeated. The pricing test covers default, paid, workspace-constrained, advanced-feature, empty and unsupported-volume states plus signup navigation. Existing narrated-demo interaction tests remain passing.

Final hydrated sweep: 153 frames, including the inline privacy-control footer at the true bottom. It waits for hydration before measurement and asserts the height has not changed by the last frame. Dark-theme checks separately verify explicit theme selection against a light OS setting, primary-action contrast, and automated pricing accessibility.
