import type { SeoPage } from "./types";

const standardChecklist = [
  "Keep the imported source values beside normalized values.",
  "Require review when amounts, currencies, or references conflict.",
  "Record every confirmed, rejected, and changed match in the audit trail.",
  "Export confirmed results only after a person has reviewed the exceptions.",
];

const productRelated = [
  { href: "/invoice-payment-matching", label: "Invoice payment matching", description: "See the exact, partial, and combined cases a matching process needs to handle." },
  { href: "/resources/how-to-reconcile-customer-payments-to-invoices", label: "Reconciliation guide", description: "Follow a practical close-ready workflow from source files to confirmed results." },
  { href: "/tools/lump-sum-invoice-matcher", label: "Lump-sum matcher", description: "Test whether one deposit equals a combination of invoice balances." },
];

export const landingPages: Record<string, SeoPage> = {
  "invoice-reconciliation-software": {
    slug: "invoice-reconciliation-software",
    title: "Invoice reconciliation software for incoming customer payments",
    metaTitle: "Invoice Reconciliation Software | InvoiceReconcile",
    description: "Match incoming payments to open customer invoices, investigate discrepancies, and keep a reviewable audit trail.",
    eyebrow: "Invoice reconciliation software",
    intro: "Invoice reconciliation software compares incoming payments with open accounts receivable records. The useful result is not a colorful score. It is a traceable suggestion that shows the payment, the invoices, the amount applied, and anything left unresolved.",
    audience: "Bookkeepers, accounting firms, and small finance teams importing invoice and payment files.",
    example: {
      label: "One ACH, three invoices",
      payment: "$4,725.00",
      invoices: ["INV-2108  $1,500.00", "INV-2141  $1,225.00", "INV-2190  $2,000.00"],
      outcome: "Exact combined total",
      note: "The payment total is exact, but the customer identity and invoice references still belong in the evidence before confirmation.",
    },
    sections: [
      {
        heading: "What invoice reconciliation actually checks",
        paragraphs: [
          "Incoming payment reconciliation starts with two independent sets of records: what customers owe and what the bank or processor says arrived. A responsible process compares amount, currency, date, payer identity, invoice references, and prior applications. It also checks whether the same row or transaction has already been imported.",
          "A match is complete only when the applied amount explains the payment and the affected invoice balances. If a payment is smaller, larger, net of a fee, or meant for several invoices, the difference must remain visible rather than being rounded away.",
        ],
        bullets: ["Exact one-to-one payments", "One deposit covering several invoices", "Partial payments and remaining balances", "Fees, deductions, overpayments, and duplicates"],
      },
      {
        heading: "Where accounting software still fits",
        paragraphs: [
          "Your accounting system remains the system of record. It holds the customer ledger, invoices, payments, journal entries, and final close. InvoiceReconcile is designed as a preparation and review layer for difficult incoming-payment work, especially when data arrives through bank exports, processor files, and spreadsheets.",
          "The initial workflow suggests matches and prepares exports. A user confirms the result before relying on it or posting it elsewhere. That separation keeps the matching logic inspectable and avoids silent changes to the books.",
        ],
      },
      {
        heading: "What to look for in reconciliation software",
        paragraphs: [
          "Start with import quality. Column detection, date parsing, currency handling, duplicate checks, and preserved source values matter more than a long integration list. Then inspect the exception workflow. You should be able to approve, reject, split, combine, record a deduction, add a note, and leave a payment unmatched without losing the original evidence.",
          "Finally, check whether decisions are auditable. Confidence labels should use plain categories and factual reasons. A reviewer should never need to guess why the system proposed a match.",
        ],
        bullets: ["CSV and XLSX previews before processing", "Clear match reasons instead of vague AI language", "Original payer and reference evidence kept with each proposal", "Exports for reconciled, unmatched, and discrepancy records"],
      },
    ],
    checklist: standardChecklist,
    related: productRelated,
    cta: "Try invoice reconciliation free",
  },
  "payment-reconciliation-software": {
    slug: "payment-reconciliation-software",
    title: "Payment reconciliation software for open invoices",
    metaTitle: "Payment Reconciliation Software | InvoiceReconcile",
    description: "Compare bank and processor payments with open invoices, then review partial, combined, and discrepant transactions.",
    eyebrow: "Payment reconciliation",
    intro: "Payment reconciliation software helps explain which receivable an incoming ACH, wire, check, or processor deposit belongs to. InvoiceReconcile focuses on that incoming-payment question, not general bookkeeping or bank account reconciliation.",
    audience: "Teams that receive customer money outside a single, automatically linked payment channel.",
    example: {
      label: "Processor fee difference",
      payment: "$4,850.00",
      invoices: ["INV-8821  $5,000.00"],
      outcome: "Review $150.00 difference",
      note: "The difference may be a fee or deduction. It should not be assumed or posted without supporting evidence and confirmation.",
    },
    sections: [
      {
        heading: "Payment reconciliation has a narrow, useful job",
        paragraphs: [
          "For accounts receivable, payment reconciliation links cash received to customer obligations. It answers which invoice or invoices were paid, how much should be applied, and what remains open. It is different from reconciling an entire bank statement to the general ledger.",
          "A focused system can evaluate invoice numbers in memos, normalized payer names, exact totals, dates, currency, and plausible invoice combinations. When those signals conflict, the payment moves to review instead of being forced into a match.",
        ],
        bullets: ["ACH and wire descriptions", "Checks with remittance references", "Processor deposits net of fees", "Imported bank and customer-ledger files"],
      },
      {
        heading: "Exceptions are the real workload",
        paragraphs: [
          "Exact matches are rarely where the month-end time goes. The difficult work sits in grouped deposits, missing references, name mismatches, partial payments, and amounts that differ from the invoice. Good payment reconciliation software removes obvious items from the queue and gives reviewers a compact evidence panel for everything else.",
          "The queue should preserve unapplied amounts and remaining invoice balances. It should also make it easy to choose another invoice or leave a transaction unresolved until remittance information arrives.",
        ],
      },
      {
        heading: "Use confidence as a routing label",
        paragraphs: [
          "Confidence is most useful when it determines the next action. Exact can mean deterministic agreement on amount and strong identifying evidence. High confidence can mean multiple strong signals. Review means a plausible explanation needs a person. Unmatched means the available data does not support a responsible suggestion.",
          "Avoid false precision. A label with visible reasons is more helpful than a decimal percentage that has not been calibrated against real outcomes.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/bank-deposit-to-invoice-matching", label: "Bank deposit matching", description: "Work through the evidence available in a bank export." },
      { href: "/cash-application-automation", label: "Cash application", description: "Understand how payment application and reconciliation connect." },
      { href: "/tools/invoice-payment-matcher", label: "Free payment matcher", description: "Paste a short list of invoices and payments to find obvious amount matches." },
    ],
    cta: "Reconcile a payment file",
  },
  "invoice-payment-matching": {
    slug: "invoice-payment-matching",
    title: "Invoice payment matching for exact, partial, and combined payments",
    metaTitle: "Invoice Payment Matching Guide and Software | InvoiceReconcile",
    description: "Learn how invoice payment matching handles exact totals, partial applications, grouped invoices, and conflicting evidence.",
    eyebrow: "Invoice payment matching",
    intro: "Invoice payment matching compares each incoming payment with open invoice balances and supporting references. Straight amounts are only the beginning. The matching method also needs to account for partial applications, grouped invoices, multiple payments, and unexplained differences.",
    audience: "Accounts receivable reviewers who need a repeatable way to route clean matches and investigate exceptions.",
    example: {
      label: "Partial application",
      payment: "$2,500.00",
      invoices: ["INV-5007  $5,000.00 open"],
      outcome: "$2,500.00 remains open",
      note: "A partial payment can be a valid application. The remaining balance should stay attached to the invoice and available for later payments.",
    },
    sections: [
      {
        heading: "Start with deterministic evidence",
        paragraphs: [
          "Amount equality is useful, but it is not sufficient when several customers owe the same amount. Strong matching also looks for an invoice number, customer identifier, transaction reference, compatible currency, and reasonable payment timing. Payer normalization can connect variations such as ABC Consulting LLC and ABC CONSULT without erasing the original text.",
          "The evidence should be stored with the proposal. That lets the reviewer see which signals increased confidence and which conflicts reduced it.",
        ],
        bullets: ["Exact amount and currency", "Invoice reference in bank memo", "Payer and customer similarity", "Date within the configured window"],
      },
      {
        heading: "Handle each relationship explicitly",
        paragraphs: [
          "A one-to-one match links one payment and one invoice. A combined match links one payment to several invoices. A grouped settlement can link several payments to one invoice. Partial and overpayment cases create remaining or unapplied amounts. These are different relationships and should not be squeezed into a single memo field.",
          "For lump sums, candidate invoices should first be narrowed by customer, currency, dates, and references. A bounded subset search can then find plausible totals without testing every invoice in the ledger.",
        ],
      },
      {
        heading: "Keep ambiguity visible",
        paragraphs: [
          "If two open invoices have the same balance and neither has a usable reference, the right result is not an automatic match. It is an ambiguous exception. The same applies when currencies differ or a discrepancy could have more than one explanation.",
          "Human confirmation is part of a sound payment workflow. It is not a failure of automation. The goal is to make that confirmation quick, factual, and auditable.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/combined-payment-invoice-matching", label: "Combined payments", description: "See how one payment can be allocated across several invoices." },
      { href: "/partial-payment-reconciliation", label: "Partial payments", description: "Preserve the applied and remaining amounts correctly." },
      { href: "/resources/invoice-reconciliation-checklist", label: "Reconciliation checklist", description: "Use a repeatable review sequence before export." },
    ],
    cta: "Match my first file",
  },
  "accounts-receivable-reconciliation": {
    slug: "accounts-receivable-reconciliation",
    title: "Accounts receivable reconciliation for incoming payments",
    metaTitle: "Accounts Receivable Reconciliation | InvoiceReconcile",
    description: "Reconcile customer invoices, payments, open balances, and discrepancies without confusing AR with accounts payable.",
    eyebrow: "Accounts receivable reconciliation",
    intro: "Accounts receivable reconciliation checks that customer invoices, received payments, credits, and remaining balances agree across the subsidiary ledger and supporting records. InvoiceReconcile covers the incoming payment matching portion of that process. It does not perform accounts payable invoice matching.",
    audience: "AR teams and bookkeepers validating customer balances before close or handoff to an accounting system.",
    example: {
      label: "Overpayment remains unapplied",
      payment: "$5,250.00",
      invoices: ["INV-3314  $5,000.00 open"],
      outcome: "$250.00 unapplied",
      note: "The excess may become a customer credit, a refund, or an application to another invoice. The reconciliation should not decide that policy silently.",
    },
    sections: [
      {
        heading: "AR reconciliation is not AP matching",
        paragraphs: [
          "Accounts receivable tracks amounts customers owe the business. Accounts payable tracks amounts the business owes suppliers. Incoming customer payment matching belongs to AR. Supplier invoice capture and bill approval belong to AP. Mixing the terms makes both the workflow and search results less useful.",
          "Within AR, payment matching is one control. A complete reconciliation may also compare the customer subledger to the general ledger control account, review aging, investigate credits, and confirm cutoff.",
        ],
      },
      {
        heading: "Build a close-ready trail",
        paragraphs: [
          "Keep source invoice balances, imported payment details, proposed applications, reviewer decisions, and exports connected by stable identifiers. That trail helps explain why an invoice was marked paid and whether an amount remained unresolved at the reporting date.",
          "Duplicates deserve special attention because the same bank transaction may arrive in more than one export. File hashes, transaction identifiers, and source lineage reduce the chance of double counting.",
        ],
        bullets: ["Tie applications to source transactions", "Separate confirmed from proposed matches", "Review unapplied cash and customer credits", "Document cutoff and unresolved exceptions"],
      },
      {
        heading: "Use the accounting system as the final ledger",
        paragraphs: [
          "InvoiceReconcile helps prepare and confirm incoming-payment matches. Your accounting system remains responsible for the posted AR ledger and financial statements. Exported results should be reviewed against the destination account, posting date, and customer record before they change the books.",
          "That boundary is especially important for deductions, foreign currency, write-offs, and credits, which may require accounting judgment beyond matching evidence.",
        ],
      },
    ],
    checklist: ["Confirm the reconciliation period and cutoff.", "Tie customer applications to bank or processor evidence.", "Review unapplied cash, credits, and negative balances.", "Reconcile the AR subledger to the general ledger separately."],
    related: [
      { href: "/resources/accounts-receivable-reconciliation-explained", label: "AR reconciliation explained", description: "Use the detailed checklist and see how the control account fits." },
      { href: "/cash-application-automation", label: "Cash application automation", description: "Focus on the operational step of applying receipts." },
      { href: "/payment-reconciliation-for-small-business", label: "Small business workflow", description: "See a lighter process for teams without a dedicated AR department." },
    ],
    cta: "Reconcile incoming payments",
  },
  "cash-application-automation": {
    slug: "cash-application-automation",
    title: "Cash application automation with reviewable payment evidence",
    metaTitle: "Cash Application Automation | InvoiceReconcile",
    description: "Automate the preparation of incoming customer payment applications while keeping exceptions and final confirmation visible.",
    eyebrow: "Cash application automation",
    intro: "Cash application assigns incoming receipts to customer invoices or accounts. Automation can prepare strong suggestions and clear routine items from the queue. It should also expose ambiguity, because a deposit is not always a clean copy of an invoice total.",
    audience: "Small finance teams handling ACH, wires, checks, and processor deposits from several sources.",
    example: {
      label: "Several payments settle one invoice",
      payment: "$3,000 + $3,000 + $4,000",
      invoices: ["INV-1042  $10,000.00 open"],
      outcome: "Complete settlement",
      note: "Each source transaction remains linked to the invoice so the final application can be traced back to the bank activity.",
    },
    sections: [
      {
        heading: "What to automate first",
        paragraphs: [
          "Begin with deterministic work: parse files, normalize fields, detect duplicates, extract references, compare amounts, and rank candidates. These steps are repeatable and can produce factual reasons. They also make the exception queue smaller without hiding the source data.",
          "Automating the final posting decision is a different risk. InvoiceReconcile initially stops at review and confirm, then produces an export. That keeps the business in control of changes to its books.",
        ],
        bullets: ["Import and column mapping", "Reference and payer normalization", "Exact and bounded combination search", "Exception routing and evidence panels"],
      },
      {
        heading: "Design the exception queue around decisions",
        paragraphs: [
          "Every exception should answer three questions quickly: what arrived, what invoices are plausible, and why the proposal needs review. From there the reviewer should be able to approve, reject, select alternatives, split a payment, record a possible deduction, or leave it unmatched.",
          "A queue is more useful than a broad dashboard when the goal is daily throughput. It places the remaining work in one ordered list and leaves clean matches out of the way.",
        ],
      },
      {
        heading: "Measure outcomes without sending financial details",
        paragraphs: [
          "Operational metrics can include payments processed, proportion routed to review, rejection rate, exception types, and time to first completed reconciliation. Analytics do not need customer names, invoice numbers, bank memos, or transaction values.",
          "Separating product analytics from financial payloads reduces unnecessary exposure while still showing whether the workflow saves reviewer effort.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/resources/cash-application-explained-for-small-businesses", label: "Cash application explained", description: "Learn the terms and build a small-business operating procedure." },
      { href: "/payment-reconciliation-software", label: "Payment reconciliation", description: "Compare cash received with open invoice evidence." },
      { href: "/invoice-reconciliation-for-bookkeepers", label: "Bookkeeper workflow", description: "Organize the work across several client ledgers." },
    ],
    cta: "Try the review workflow",
  },
  "bank-deposit-to-invoice-matching": {
    slug: "bank-deposit-to-invoice-matching",
    title: "Match bank deposits to customer invoices with traceable evidence",
    metaTitle: "Bank Deposit to Invoice Matching | InvoiceReconcile",
    description: "Use amount, date, payer, references, and invoice combinations to explain incoming bank deposits.",
    eyebrow: "Bank deposit matching",
    intro: "A bank feed tells you that money arrived, but the description may not identify which invoices it settles. Matching deposits to invoices combines bank evidence with the open receivables list and preserves any amount that cannot yet be explained.",
    audience: "Businesses receiving external ACH, wire, and check payments that are not already linked to invoice records.",
    example: {
      label: "Payer name variation",
      payment: "$1,250.00 from ABC CONSULT",
      invoices: ["INV-10487  $1,250.00", "Customer: ABC Consulting LLC"],
      outcome: "High confidence, review identity",
      note: "The amount and normalized name agree. An invoice reference in the bank memo would strengthen the proposal further.",
    },
    sections: [
      {
        heading: "Use every useful field in the bank export",
        paragraphs: [
          "Bank files can include posted date, amount, description, payer, ACH identifier, wire reference, memo, and transaction ID. These fields vary by institution, so the importer should preview mappings and preserve columns it does not recognize rather than discarding them.",
          "A normalized copy helps comparison, but the original bank text should stay visible. Reviewers often need punctuation, spacing, or an identifier that a normalization step removed.",
        ],
        bullets: ["Posted date and amount", "Bank transaction identifier", "Originator or payer text", "Memo, ACH, wire, and check references"],
      },
      {
        heading: "Separate deposits from payment applications",
        paragraphs: [
          "One bank deposit can represent one payment, several checks in a batch, or a processor settlement net of fees. Do not assume each deposit maps to one invoice. First identify the payment source and whether grouping happened before the money reached the bank.",
          "When the deposit is a lump sum, search for invoice combinations only within a sensible customer, currency, and date scope. An exact total across unrelated customers may still be coincidental.",
        ],
      },
      {
        heading: "Make unresolved cash explicit",
        paragraphs: [
          "If there is no responsible match, keep the deposit unmatched and record what information is missing. If only part of the amount can be explained, show both the applied and unapplied portions. This gives the reviewer a concrete follow-up list instead of a false sense of completion.",
          "A later remittance email or corrected invoice reference can then resolve the exception without recreating the original import.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/resources/why-bank-deposits-and-invoice-totals-do-not-always-match", label: "Why totals differ", description: "Review batching, fees, partials, deductions, and timing." },
      { href: "/combined-payment-invoice-matching", label: "Combined payment matching", description: "Find several invoice balances behind one bank total." },
      { href: "/tools/invoice-reference-cleaner", label: "Reference cleaner", description: "Normalize a short list of messy bank and invoice references." },
    ],
    cta: "Match a bank export",
  },
  "combined-payment-invoice-matching": {
    slug: "combined-payment-invoice-matching",
    title: "Match one combined payment to multiple invoices",
    metaTitle: "Combined Payment Invoice Matching | InvoiceReconcile",
    description: "Find invoice combinations that equal one ACH, wire, check, or deposit while keeping customer and reference evidence visible.",
    eyebrow: "Combined payment matching",
    intro: "Customers often pay several invoices in one ACH or check. The deposit total no longer equals any single open balance, so the reviewer has to identify the right combination without accidentally including a coincidental amount.",
    audience: "Teams that repeatedly search open invoice lists for combinations that equal a lump-sum payment.",
    example: {
      label: "Combination found",
      payment: "$4,725.00",
      invoices: ["$1,500.00", "$1,225.00", "$2,000.00"],
      outcome: "3 invoices total $4,725.00",
      note: "The combination explains the amount. Customer identity, currency, dates, and references determine whether it is safe to confirm.",
    },
    sections: [
      {
        heading: "Why combined payments are difficult",
        paragraphs: [
          "A payment may cover recent invoices, selected overdue balances, or a mix that reflects the customer's remittance advice. Simple amount matching fails because no individual invoice equals the payment. Manual spreadsheet work can also produce several mathematical combinations when many balances are similar.",
          "The best candidate is therefore not just the first set that adds correctly. It should use a narrowed pool and explain why those invoices belong together.",
        ],
      },
      {
        heading: "Narrow first, then search combinations",
        paragraphs: [
          "Begin with the payer or known customer alias, compatible currency, date window, open status, and any invoice references found in the memo. Then run a bounded subset search on that smaller list. Limits on candidate count and combination size prevent the search from growing without control.",
          "If more than one combination totals the payment, return an ambiguity for review. Reference evidence or remittance details may separate the candidates.",
        ],
        bullets: ["Restrict by customer or payer alias", "Keep currencies separate", "Prefer referenced and recent invoices", "Show all plausible exact combinations within the limit"],
      },
      {
        heading: "Confirm the allocation, not only the total",
        paragraphs: [
          "The reviewer should see each chosen invoice, its open balance, and the amount applied. Confirming creates one payment-to-many-invoices relationship and preserves the automated explanation in the audit log.",
          "If the customer paid only part of one invoice within the group, the remaining balance must stay open. A combined payment can contain both full and partial applications.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/tools/lump-sum-invoice-matcher", label: "Free lump-sum matcher", description: "Enter a payment and a short invoice list to find exact combinations." },
      { href: "/resources/how-to-match-one-payment-to-multiple-invoices", label: "Step-by-step guide", description: "Document and verify a one-to-many application." },
      { href: "/partial-payment-reconciliation", label: "Partial payments", description: "Handle a combined payment that does not settle every invoice in full." },
    ],
    cta: "Find invoice combinations",
  },
  "partial-payment-reconciliation": {
    slug: "partial-payment-reconciliation",
    title: "Partial payment reconciliation without losing the remaining balance",
    metaTitle: "Partial Payment Reconciliation | InvoiceReconcile",
    description: "Apply part of a customer payment to an invoice, preserve the remaining balance, and keep later payments connected.",
    eyebrow: "Partial payments",
    intro: "A partial payment is not a failed exact match. It is a valid application relationship with an amount applied now and a balance that remains collectible. The reconciliation record should make both numbers explicit.",
    audience: "Service businesses and bookkeepers handling deposits, installment plans, retainers, and customer underpayments.",
    example: {
      label: "Half paid",
      payment: "$2,500.00",
      invoices: ["INV-5007  $5,000.00 open"],
      outcome: "$2,500.00 applied, $2,500.00 remaining",
      note: "A later payment can settle the rest. Both source transactions remain linked to the same invoice history.",
    },
    sections: [
      {
        heading: "Preserve applied, outstanding, and unapplied amounts",
        paragraphs: [
          "Three numbers may matter: the amount applied to an invoice, the invoice balance still outstanding, and any portion of the payment that remains unapplied. A clean data model stores these separately. It should not overwrite the original invoice amount or treat the source payment as if it changed.",
          "When a customer sends a deposit before final billing, the proper accounting treatment may depend on business policy. Matching software can show candidate records, but a reviewer decides how the amount should be handled in the accounting system.",
        ],
      },
      {
        heading: "Connect later receipts to the same invoice",
        paragraphs: [
          "Several payments can settle one invoice over time. Each payment needs its own date, amount, source reference, and audit trail. The invoice then shows cumulative applications and a remaining balance until fully settled.",
          "This history helps distinguish a legitimate installment from a duplicate import. It also gives the reviewer evidence when a customer disputes the open amount.",
        ],
        bullets: ["Retain every source payment", "Update the remaining balance only after confirmation", "Detect repeated transaction identifiers", "Show cumulative applications in the audit trail"],
      },
      {
        heading: "Do not relabel deductions as partials without review",
        paragraphs: [
          "A payment below the invoice balance could be a planned installment, a fee, a discount, a withholding, or an error. Amount alone does not determine the reason. Reference text, customer history, and remittance evidence can support a suggestion, but the difference should remain visible.",
          "A review queue lets the user choose partial application, possible deduction, or unmatched status instead of hiding uncertainty behind one category.",
        ],
      },
    ],
    checklist: standardChecklist,
    related: [
      { href: "/tools/partial-payment-allocation", label: "Partial allocation calculator", description: "Plan an application and see the remaining invoice and payment balances." },
      { href: "/resources/how-to-handle-partial-invoice-payments", label: "Partial payment guide", description: "Document installment, underpayment, and follow-up procedures." },
      { href: "/invoice-payment-matching", label: "Matching methods", description: "Compare one-to-one, grouped, partial, and overpayment relationships." },
    ],
    cta: "Review partial payments",
  },
  "quickbooks-invoice-reconciliation": {
    slug: "quickbooks-invoice-reconciliation",
    title: "Invoice reconciliation alongside QuickBooks Online",
    metaTitle: "QuickBooks Invoice Reconciliation Workflow | InvoiceReconcile",
    description: "Understand QuickBooks Online bank matching and where a separate exception workflow can help with external incoming payments.",
    eyebrow: "QuickBooks workflow",
    intro: "QuickBooks Online can suggest matches between downloaded bank transactions and records already entered in QuickBooks. Eligible QuickBooks product transactions can also be automatically matched. InvoiceReconcile is intended to complement that system of record when external payment files and difficult exceptions need preparation outside the ledger.",
    audience: "QuickBooks users receiving ACH, wires, checks, or processor payments through workflows that do not arrive as clean native links.",
    example: {
      label: "Grouped bank deposit",
      payment: "$7,400.00 deposit",
      invoices: ["INV-8140  $2,400.00", "INV-8161  $5,000.00"],
      outcome: "Review 2-invoice allocation",
      note: "Intuit documents that grouped deposits and fee differences may not receive a match suggestion. Verify current behavior in your own QuickBooks account.",
    },
    sections: [
      {
        heading: "What QuickBooks Online matching can do",
        paragraphs: [
          "Intuit documents that QuickBooks Online can suggest existing records for downloaded bank transactions and that a user reviews the match before posting. Intuit also documents automatic matching for eligible QuickBooks Payments and other QuickBooks product transactions, with availability and identifiers affecting the result.",
          "Those native capabilities are valuable and should be used when they fit the workflow. InvoiceReconcile is not positioned as a replacement for QuickBooks, its bank feed, or its receivables ledger.",
        ],
        bullets: ["Suggested matches for downloaded bank activity", "Native records remain in the accounting system", "Review and undo controls inside QuickBooks", "Automatic matching for eligible QuickBooks product transactions"],
      },
      {
        heading: "Where a preparation layer may help",
        paragraphs: [
          "Intuit notes cases where match suggestions may not appear, including fee or discount differences, several payments grouped into one deposit, dates outside the match range, and records already reconciled. External files can also arrive with column names and references that need normalization before review.",
          "InvoiceReconcile prepares those cases in an exception queue, keeps the source evidence, and exports confirmed results. Any posting or write-back should remain a deliberate user action.",
        ],
      },
      {
        heading: "Check current product behavior before relying on a workflow",
        paragraphs: [
          "Accounting software features and availability change. Review the current Intuit help documentation and test with a non-production company before adopting a new process. The linked official documentation below was reviewed for this page in August 2026.",
          "Do not assume that a spreadsheet import or third-party suggestion has changed QuickBooks. Confirm the destination records after export or any future integration action.",
        ],
        bullets: ["Read Intuit's bank transaction matching guide", "Review automatic matching availability", "Test grouped deposits and fee differences", "Keep confirmation and posting steps separate"],
      },
    ],
    checklist: ["Use QuickBooks as the system of record.", "Verify the exact company and bank account before posting.", "Review Intuit's current matching documentation.", "Confirm exported applications against the QuickBooks customer ledger."],
    related: [
      { href: "https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US", label: "Intuit bank matching help", description: "Read Intuit's current instructions for matching bank and credit card transactions." },
      { href: "/quickbooks-payment-matching", label: "QuickBooks payment matching", description: "Focus on external receipts and the review handoff." },
      { href: "/resources/how-to-reconcile-customer-payments-to-invoices", label: "Reconciliation procedure", description: "Build a source-to-ledger control around the matching step." },
    ],
    cta: "Prepare QuickBooks exceptions",
  },
  "quickbooks-payment-matching": {
    slug: "quickbooks-payment-matching",
    title: "QuickBooks payment matching for external incoming payments",
    metaTitle: "QuickBooks Payment Matching Workflow | InvoiceReconcile",
    description: "Prepare external payment matches for QuickBooks while keeping grouped deposits, fees, and unresolved items under review.",
    eyebrow: "QuickBooks payment matching",
    intro: "External ACH, wire, check, and processor workflows can create payments that need more investigation before they reach the customer ledger. A preparation layer can organize those exceptions, but QuickBooks remains the final accounting record.",
    audience: "Bookkeepers who export open invoices from QuickBooks and receive payment evidence from banks or processors.",
    example: {
      label: "External ACH with invoice reference",
      payment: "$3,180.00, memo INV-6204",
      invoices: ["INV-6204  $3,180.00 open"],
      outcome: "Exact reference and amount",
      note: "The proposal can be prepared outside QuickBooks, then reviewed against the current customer balance before posting or import.",
    },
    sections: [
      {
        heading: "Separate source collection from ledger posting",
        paragraphs: [
          "The bank or processor provides evidence that money arrived. QuickBooks provides the open invoice and customer ledger. InvoiceReconcile compares exported records and prepares suggested applications without claiming that the accounting system has changed.",
          "This separation supports testing with CSV or XLSX files and avoids pretending that an integration is connected when OAuth credentials are not configured.",
        ],
      },
      {
        heading: "Resolve the awkward cases before handoff",
        paragraphs: [
          "Grouped payments, fee-net deposits, partial payments, payer name changes, and missing references can make a simple suggested match unavailable or uncertain. An exception queue lets a reviewer document how the deposit relates to invoice balances before exporting a result.",
          "The export should include stable identifiers, applied amounts, remaining amounts, and reviewer notes. The user then verifies the destination customer and account inside QuickBooks.",
        ],
        bullets: ["Compare current open balances", "Review duplicate source transactions", "Explain every discrepancy", "Retain a separate reconciliation audit trail"],
      },
      {
        heading: "Use native QuickBooks matching where it works",
        paragraphs: [
          "Intuit supports matching downloaded bank transactions to records in QuickBooks Online and automatic matching for certain QuickBooks product transactions. There is no value in recreating a native clean workflow solely to add another tool.",
          "A separate reconciliation layer is most useful where multiple source files, client workspaces, or difficult payment relationships create repeated manual investigation.",
        ],
      },
    ],
    checklist: ["Refresh invoice balances before matching.", "Confirm currency and bank account.", "Review every exception before export.", "Verify the posted result in QuickBooks."],
    related: [
      { href: "/quickbooks-invoice-reconciliation", label: "QuickBooks invoice reconciliation", description: "See the boundary between native matching and an external preparation layer." },
      { href: "/excel-invoice-reconciliation", label: "Spreadsheet workflow", description: "Prepare clean CSV or XLSX files for matching." },
      { href: "/invoice-reconciliation-for-bookkeepers", label: "Bookkeeper operations", description: "Manage the process across multiple client workspaces." },
    ],
    cta: "Try with exported files",
  },
  "excel-invoice-reconciliation": {
    slug: "excel-invoice-reconciliation",
    title: "Invoice reconciliation in Excel and when to move beyond it",
    metaTitle: "Invoice Reconciliation in Excel | Guide and Templates",
    description: "Build a controlled Excel invoice reconciliation process, then identify when matching software can reduce exception work.",
    eyebrow: "Excel reconciliation",
    intro: "Excel is a reasonable starting point for small, stable reconciliation volumes. The risk appears when manual lookups, copied formulas, changing exports, and multi-invoice deposits turn one workbook into an undocumented operating system.",
    audience: "Teams currently comparing open invoice exports and bank transactions in Excel or CSV files.",
    example: {
      label: "Lookup cannot explain a lump sum",
      payment: "$4,725.00",
      invoices: ["$1,500.00", "$1,225.00", "$2,000.00"],
      outcome: "Combination needed",
      note: "A single exact lookup will miss the relationship. A combination search needs a narrowed candidate set and review evidence.",
    },
    sections: [
      {
        heading: "A controlled spreadsheet setup",
        paragraphs: [
          "Keep invoices and payments in separate Excel tables. Give each row a stable source identifier. Preserve original text columns, then add dedicated normalized fields for amount, date, customer, and reference. Avoid editing the imported source cells in place.",
          "Create an applications table rather than writing a matched invoice number directly into the payment row. This supports one payment to several invoices and several payments to one invoice.",
        ],
        bullets: ["Invoices table with original and outstanding amounts", "Payments table with source transaction IDs", "Applications table with payment, invoice, and applied amount", "Exceptions table with owner, reason, and next action"],
      },
      {
        heading: "Controls Excel will not add for you",
        paragraphs: [
          "Spreadsheets allow almost any edit, which is both their strength and their weakness. Add protected formula columns, validation for statuses, a duplicate identifier check, versioned source files, and a reconciliation control total. Review formula ranges whenever rows are appended.",
          "Do not use floating point equality for currency comparisons. Normalize to cents or use fixed-decimal values, and display the tolerance policy clearly.",
        ],
      },
      {
        heading: "Signals that specialized software may help",
        paragraphs: [
          "Consider a dedicated workflow when multiple people edit the workbook, imports change every month, grouped payments are common, files span several clients, or reviewers cannot reconstruct who confirmed a match. The goal is not to ban spreadsheets. It is to stop asking one workbook to provide import validation, matching logic, collaboration, and audit history at once.",
          "InvoiceReconcile accepts CSV and XLSX files so the transition can start with current exports rather than a required accounting integration.",
        ],
      },
    ],
    downloads: [
      { href: "/sample-data/northstar-invoices.csv", label: "Download sample invoice CSV", description: "Fictional Northstar Services open invoices with realistic references and balances." },
      { href: "/sample-data/northstar-payments.csv", label: "Download sample payment CSV", description: "Fictional incoming payments with exact, combined, partial, fee, duplicate, and unmatched cases." },
    ],
    checklist: ["Keep raw source columns unchanged.", "Use stable identifiers and duplicate checks.", "Tie payment and invoice totals before sign-off.", "Archive each approved period with reviewer evidence."],
    related: [
      { href: "/resources/how-to-reconcile-invoices-in-excel", label: "Excel step-by-step guide", description: "Set up the tables, formulas, controls, and exception list." },
      { href: "/compare/spreadsheets-vs-invoice-reconciliation-software", label: "Spreadsheets vs software", description: "Compare cost, flexibility, auditability, and volume limits fairly." },
      { href: "/app/demo", label: "Sample CSV workflow", description: "Use fictional invoice and payment files in a working reconciliation." },
    ],
    cta: "Import an Excel file",
  },
  "invoice-reconciliation-for-bookkeepers": {
    slug: "invoice-reconciliation-for-bookkeepers",
    title: "Invoice reconciliation for bookkeepers managing many clients",
    metaTitle: "Invoice Reconciliation for Bookkeepers | InvoiceReconcile",
    description: "Organize payment matching, exception review, isolated records, and audit history across bookkeeping workspaces.",
    eyebrow: "For bookkeepers",
    intro: "Bookkeepers repeat the same incoming-payment process across clients, but each client has different files, payer names, fee behavior, and review cadence. A multi-client reconciliation workspace should show where attention is needed without mixing client data or rules.",
    audience: "Independent bookkeepers and bookkeeping teams serving several small business clients.",
    example: {
      label: "Portfolio exception view",
      payment: "18 exceptions",
      invoices: ["Acme Plumbing  11", "Bright Dental  7", "Smith Electric  0"],
      outcome: "Open the clients with work",
      note: "Client workspaces keep imports, normalized records, decisions, and audit events separate while the portfolio view summarizes operational counts.",
    },
    sections: [
      {
        heading: "Run the queue, not a folder hunt",
        paragraphs: [
          "A firm-level view should show last import, matched count, review count, unresolved count, and last reconciliation by client. From there a bookkeeper can jump directly to the exceptions rather than opening every file to see whether work remains.",
          "The summary should avoid exposing unnecessary transaction values. Operational counts are usually enough to route work across the team.",
        ],
      },
      {
        heading: "Keep client context scoped",
        paragraphs: [
          "A bank description that identifies one customer's legal entity may mean something else in another workspace. Source payer names, invoice references, date evidence, and reviewer decisions should remain attached to the correct client and import.",
          "Organization roles and row-level policies should prevent one client workspace from reading another. Server checks must enforce the same boundary even if a user edits a URL.",
        ],
        bullets: ["Separate client workspaces", "Mapping preview on every import", "Inspectable payer evidence", "Portfolio counts without merged financial records"],
      },
      {
        heading: "Make handoff easy to review",
        paragraphs: [
          "An audit log should record the source file, automated reasons, reviewer, decision, and final applications. Exports can then accompany the bookkeeping close package and show what remains unmatched.",
          "For messy first files, a client can send them through an authenticated support workflow. Do not expose financial uploads through an unprotected public form.",
        ],
      },
    ],
    checklist: ["Confirm the active client before every import.", "Review detected columns before processing.", "Review the portfolio exception count daily.", "Export unresolved items with an owner and next action."],
    related: [
      { href: "/solutions/bookkeepers", label: "Bookkeeper solution", description: "See the product workflow and multi-client operating model." },
      { href: "/industries/bookkeepers", label: "Bookkeeping practice", description: "Review client cadence, controls, and handoff examples." },
      { href: "/tools/reconciliation-time-calculator", label: "Time calculator", description: "Estimate current manual matching hours using your own inputs." },
    ],
    cta: "Set up a client workspace",
  },
  "payment-reconciliation-for-accounting-firms": {
    slug: "payment-reconciliation-for-accounting-firms",
    title: "Payment reconciliation for accounting firms",
    metaTitle: "Payment Reconciliation for Accounting Firms | InvoiceReconcile",
    description: "Standardize incoming payment review across clients while preserving workspace isolation, evidence, and reviewer accountability.",
    eyebrow: "For accounting firms",
    intro: "Accounting firms need a repeatable incoming-payment method that can accommodate each client's source files without turning every engagement into a custom spreadsheet. The operating model matters as much as the matching logic.",
    audience: "Accounting firms with recurring bookkeeping or outsourced AR work across several client entities.",
    example: {
      label: "Shared review standard",
      payment: "$9,100.00 wire",
      invoices: ["2 referenced invoices", "1 possible unreferenced invoice"],
      outcome: "Review referenced pair first",
      note: "The evidence format stays consistent even when source exports differ, which helps reviewers and engagement leads inspect the decision.",
    },
    sections: [
      {
        heading: "Standardize decisions, not client data",
        paragraphs: [
          "A common import, match, review, confirm, and export sequence gives the firm one quality standard. Client records, decisions, integrations, and files remain isolated inside each workspace. This balance supports training without flattening important client differences.",
          "Role checks should distinguish firm administrators, members, and read-only reviewers where applicable. Admin analytics should use operational aggregates rather than exposing client bank memos or invoice values.",
        ],
      },
      {
        heading: "Make review evidence consistent",
        paragraphs: [
          "Every proposed match should show payment source, amount, date, payer, reference, selected invoices, discrepancy, method, and reasons. The same layout lets a reviewer move between clients without relearning the screen.",
          "Exception categories also improve quality monitoring. A rising count of invalid dates or missing amount columns may point to an import process issue, while repeated payer mismatches may justify a client-specific alias.",
        ],
        bullets: ["Consistent confidence labels", "Source-aware import errors", "Reviewer and timestamp on every decision", "Unresolved exception export by client"],
      },
      {
        heading: "Adopt in stages",
        paragraphs: [
          "Start with one client whose open invoice and payment exports are reliable. Compare suggested matches with the existing procedure, review every exception, and verify the final ledger. Add more clients only after the team agrees on roles, retention, sign-off, and escalation.",
          "This staged approach tests the workflow on real operational variation without pretending that every accounting engagement has the same risk or data quality.",
        ],
      },
    ],
    checklist: ["Document one firm-wide review policy.", "Keep source and rules isolated by client.", "Require a named reviewer for exceptions.", "Verify exports against the client ledger."],
    related: [
      { href: "/solutions/accounting-firms", label: "Accounting firm solution", description: "Explore multi-client routing and team review." },
      { href: "/industries/accounting-firms", label: "Accounting firm operations", description: "See engagement-specific controls and examples." },
      { href: "/invoice-reconciliation-for-bookkeepers", label: "Bookkeeper workflow", description: "Compare a lighter practice-oriented operating model." },
    ],
    cta: "Create a firm workspace",
  },
  "payment-reconciliation-for-small-business": {
    slug: "payment-reconciliation-for-small-business",
    title: "Payment reconciliation for small business finance teams",
    metaTitle: "Payment Reconciliation for Small Business | InvoiceReconcile",
    description: "Match customer payments to invoices without replacing your accounting system or requiring a long implementation.",
    eyebrow: "For small business",
    intro: "Small businesses often receive customer payments through more channels than their accounting workflow was designed to handle. A practical reconciliation layer can compare current exports, surface difficult deposits, and keep the final decision with the person responsible for the books.",
    audience: "Owner-led finance teams and service businesses with recurring invoice volume and limited AR staff.",
    example: {
      label: "Missing reference",
      payment: "$1,800.00 from NORTHSTAR OPS",
      invoices: ["INV-7742  $1,800.00", "Customer: Northstar Operations"],
      outcome: "Review payer similarity",
      note: "A responsible suggestion explains the amount and name evidence, then asks a person to confirm because the invoice number is missing.",
    },
    sections: [
      {
        heading: "Begin with the files you already have",
        paragraphs: [
          "Export open invoices from the accounting system and incoming payments from the bank or processor. Preview the columns, verify dates and currency, and preserve the original files. A first test should not require a sales call, credit card, or new bank connection.",
          "Sample data can teach the workflow before the business imports its own records. When real files are used, they should sit behind authentication and workspace access controls.",
        ],
      },
      {
        heading: "Focus on exceptions with business impact",
        paragraphs: [
          "Clean one-to-one payments can be confirmed quickly. The team can spend its attention on underpayments, grouped deposits, fees, duplicates, and missing references. Each exception should have an owner and a clear next action, such as requesting remittance advice or choosing a customer record.",
          "Do not write off a discrepancy merely to clear the queue. Matching evidence and accounting treatment are related but distinct decisions.",
        ],
        bullets: ["Explain what remains unmatched", "Show the amount at risk of misapplication", "Keep customer follow-up notes", "Export only confirmed applications"],
      },
      {
        heading: "Know when the workflow is working",
        paragraphs: [
          "Track time to first reconciliation, payments processed, exception rate, rejected suggestions, and recurring error types. These measures show whether the process is reducing manual lookup without requiring financial values in analytics.",
          "A growing unmatched queue is a signal to improve source data or customer remittance practices, not a reason to lower the matching standard.",
        ],
      },
    ],
    checklist: ["Test with sample data first.", "Import current open balances and posted payments.", "Confirm exceptions with supporting evidence.", "Verify the export before updating the accounting system."],
    related: [
      { href: "/solutions/small-business", label: "Small business solution", description: "See the five-step product workflow." },
      { href: "/resources/cash-application-explained-for-small-businesses", label: "Cash application basics", description: "Build a clear procedure without enterprise terminology." },
      { href: "/tools/reconciliation-time-calculator", label: "Time calculator", description: "Estimate current manual effort and labor cost." },
    ],
    cta: "Reconcile my first file",
  },
};

export const landingPageSlugs = Object.keys(landingPages);
