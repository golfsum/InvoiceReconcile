# Matching engine

InvoiceReconcile uses deterministic financial rules. It does not ask a language model to decide where money should be applied. Every suggestion includes the payment IDs, invoice IDs, amounts, discrepancy, method, confidence category, and factual evidence used to produce it.

## Money and dates

Amounts use integer minor currency units. For example, USD 1,250.00 is stored as `125000`. This avoids floating point rounding during combination searches and balance calculations.

Dates use ISO calendar values in `YYYY-MM-DD` form. The default matching window accepts payments from 3 days before an invoice date through 90 days after it. A workspace may override both bounds.

Currency conversion is not implicit. A likely payment and invoice with different currencies produce a blocked `currency_mismatch` result with no applied amount.

## Confidence categories

| Category | Meaning |
| --- | --- |
| Exact | Exact financial amount plus a very strong deterministic signal, usually an invoice reference in payment text. |
| High confidence | Exact amount or exact combined amount with a strong payer, customer, date, or account identity. |
| Review | A plausible suggestion that needs a person, including partials, overpayments, possible fees, weak amount-only matches, and ambiguity. |
| Unmatched | No responsible application was found, or currency rules block the likely application. |

The engine does not display a percentage that implies statistical calibration. Name similarity is an internal deterministic candidate signal. User-facing results use the categories above and the accompanying evidence.

## Evaluation order

The public `reconcile(invoices, payments, config?, context?)` function applies rules in this order:

1. Detect duplicate payments and duplicate invoices. Duplicate records are excluded from allocation and reported separately.
2. Reserve strong exact one-to-one matches.
3. Search for one payment that equals a combination of open invoices.
4. Search for several payments that together settle one open invoice.
5. Evaluate remaining payments for currency mismatch, ambiguous exact matches, partial payments, possible fees or deductions, overpayments, weak review candidates, and unmatched status.

This order prevents three installments from being consumed as unrelated partial suggestions before the complete payment group can be recognized.

## Indexed candidate selection

The engine builds deterministic in-memory indexes once per run. It does not rescan every invoice for every payment or every payment for every invoice.

The indexes cover:

- currency, current outstanding balance, and invoice date for exact one-to-one lookup
- currency and invoice date for the final responsible-candidate pass
- normalized customer and payer names, customer IDs, and payer IDs for identity lookup
- active payer mappings resolved to their customer target
- normalized invoice references resolved against payment search text

Outstanding-balance buckets update whenever a suggestion consumes all or part of an invoice. Allocated payments and fully consumed invoices are removed from candidate indexes. This keeps later rules consistent with the same remaining-balance state used by the result payload.

Reference lookup uses bounded normalized keys to find possible references, then verifies the full invoice reference against the payment text. A key collision cannot become matching evidence without the full deterministic containment check.

## Candidate safety budget

Candidate retrieval is bounded before expensive scoring. The default evaluation limit is 256 qualifying records per query, and at most 25 candidate invoice IDs are included in a review payload.

The engine never ranks a truncated candidate set and applies the apparent winner. If an exact-balance, identity, grouped-payment, cross-currency, or final date-window query exceeds its evaluation limit, the affected payment receives an `ambiguous` review result with:

- zero applied amount
- `candidate_limit_exceeded` evidence
- the known minimum candidate count
- a bounded list of candidate invoice IDs
- guidance to narrow the import or add stronger payer and reference data

This behavior protects adversarial imports where hundreds or thousands of open invoices share the same date, currency, amount, or payer. It also makes overload visible instead of silently changing the answer based on array order.

## Identity and reference normalization

Invoice references and payment text are normalized to uppercase letters and digits before containment checks. Common punctuation and spacing differences therefore do not hide `INV-10487` inside a memo such as `ACH ACME INV10487`.

Entity names are normalized for case, punctuation, accents, common legal suffixes, and common bank description words. A deterministic bigram and prefix comparison can responsibly relate names such as `ABC CONSULT` and `ABC Consulting LLC`. Exact customer IDs, payer IDs, and account IDs remain stronger signals when present.

## Workspace rule safety

Solo workspaces can keep exact normalized payer mappings. Business and Bookkeeper workspaces in active organizations can also create three inspectable custom rule types:

- Description-to-customer mappings use a normalized literal phrase of 4 to 120 characters.
- Reference templates use one bounded `{digits}` or `{alnum}` token plus at least two literal characters. User-provided regex, scripts, and unbounded wildcards are rejected by the route and database function.
- Accepted fee behavior uses a normalized literal descriptor, a maximum amount, and a maximum percentage. It can only add evidence to a short payment that already passes the engine's stricter global fee limits.

Custom pattern sources accept basic ASCII characters only. The route and database enforce the same restriction so the TypeScript and PostgreSQL normalizers cannot disagree about accented or compatibility characters.

Custom rules compile once and are evaluated once per payment before candidate scoring. Candidate loops read the resulting description target, extracted reference, and fee-review evidence from a map. They never execute a user pattern inside invoice scoring or subset search.

Description evidence cannot apply when matching patterns point to different customers. Reference and description evidence still pass through currency, date, candidate-count, and ambiguity controls. Template-derived reference evidence never removes confirmation by itself; exact, no-confirmation results require native unambiguous invoice references. A fee rule never changes the applied amount, assumes the difference is a fee, or removes `requiresConfirmation`.

Every active behavior set has a deterministic SHA-256 fingerprint. The durable run key and saved reconciliation context include the payer-mapping fingerprint and, when an eligible custom rule exists, the custom-rule fingerprint. Editing behavior therefore creates a distinct result identity in both request and durable workflow processing. With no custom rules, the Northstar result remains byte-for-byte identical.

## Combination bounds

Subset search is bounded to protect import jobs from exponential work:

| Search | Candidate limit | Combination size limit | Node limit |
| --- | ---: | ---: | ---: |
| One payment to invoices | 18 | 6 | 50,000 |
| Payments to one invoice | 12 | 6 | 50,000 |

Candidates are narrowed before search by remaining balance, currency, date, reference, and payer identity. Limits are configurable. When more than one responsible combination is found, the result is `ambiguous` and no amount is applied by the suggestion.

The combination limits apply after the broader 256-record candidate evaluation budget. The evaluation budget prevents scoring an unbounded population. The smaller combination limits bound the exponential subset search itself.

## Difficult payment handling

- Partial payment: apply no more than the payment amount and keep the remaining invoice balance visible.
- Possible fee or deduction: when the payment is short by no more than 5 percent of the invoice and no more than 250 currency units, label the difference for review. Never assume it is a processor fee.
- Overpayment: apply the invoice balance and keep the excess as unapplied payment.
- Duplicate: report the canonical record and duplicate IDs. Do not silently count both.
- Ambiguous: return all candidate invoice IDs and require selection.
- Currency mismatch: block automatic application until a future explicit conversion workflow exists.

## Import normalization

The import helpers under `src/lib/imports` support CSV records and worksheet row values from XLSX readers. They provide:

- flexible header suggestions for common invoice and payment exports
- currency symbols, thousands separators, decimal comma formats, and accounting negatives
- ISO, named month, MDY, DMY, JavaScript `Date`, and Excel serial dates
- Excel formula result, rich text, text, and hyperlink cell values
- blank row tracking
- rejected row issues with the source row and original value
- duplicate row detection
- deterministic source file fingerprints for import idempotency
- preservation of each original row, including extra columns

Callers should present rejected rows and skipped blank row counts in import preview. They should not discard them without telling the user.

## Demo fixture

`northstarDemoFixture` contains 30 fictional invoices and 22 fictional payments for Northstar Services. Downloadable versions are available at:

- `/sample-data/northstar-invoices.csv`
- `/sample-data/northstar-payments.csv`

The fixture includes exact reference matches, one payment covering three invoices, two partial payments, a possible fee or deduction, an overpayment, three payments settling one invoice, a duplicate transaction, and unmatched payments.

## Verification

Run the focused tests with:

```sh
npx vitest run tests/reconciliation
```

The suite covers the required deterministic matching cases, bounded custom rules, plan gating, ambiguity, duplicate handling, import idempotency, malformed CSV, currency formats, date formats, and XLSX-style computed cell values.

Run the repeatable scale benchmark with:

```sh
npm run benchmark:engine
```

Measured on the local Windows release runner with Node.js 24 after a 100-record warmup:

| Fixture | Broad-scan baseline | Indexed engine |
| --- | ---: | ---: |
| 1,000 invoices and 1,000 payments | 4,079 ms | 89.3 ms |
| 5,000 invoices and 5,000 payments | Not run due to quadratic baseline growth | 412.0 ms |

All 5,000 benchmark payments were allocated to their exact referenced invoice. The release budget is 30,000 ms.

The Northstar fixture result is also guarded as a complete JSON parity snapshot. Its expected SHA-256 is `1f38a04f495df68b740fd90846a11285b652cc49ef58ed745051b6a8a6eab9b8`, including match order, amounts, confidence, reasons, and evidence.
