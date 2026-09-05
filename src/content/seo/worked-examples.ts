import type { ResourceArticle } from "./types";

export const workedExamples: ResourceArticle[] = [
  {
    slug: "accounts-receivable-reconciliation-example",
    title: "Accounts receivable reconciliation example: invoices to closing balance",
    description: "Follow a worked AR reconciliation example with invoice balances, combined and partial payments, a credit memo, and an explained ledger difference.",
    category: "How-to",
    readingMinutes: 6,
    published: "2026-09-05",
    updated: "2026-09-05",
    intro: "To reconcile accounts receivable, explain the movement in customer balances, connect payments to invoices, and compare the resulting subledger with the general ledger for the same cutoff. This fictional USD example starts with $12,000 due and ends with $8,000 due. It separates payment matching from the additional ledger checks needed to finish an AR reconciliation.",
    sections: [
      {
        heading: "1. Freeze the period and assemble the evidence",
        paragraphs: ["Cedar Lane Studio is a fictional business reconciling August 2026. Its opening AR is $12,000. During August it issues a $3,000 invoice, applies $6,500 of customer receipts, and issues a $500 credit memo. There are no write-offs, foreign-currency changes, or other adjustments in this simplified example.", "Use the same August 31 cutoff for the customer subledger and ledger comparison. Keep the original invoice, receipt, credit memo, and bank references. Do not compare today's open-invoice export with a prior-month ledger and treat the difference as an error."],
      },
      {
        heading: "2. Match each payment to the intended invoices",
        paragraphs: ["A $4,500 ACH includes remittance identifying two invoices for the same customer: INV-101 for $3,000 and INV-102 for $1,500. A second customer pays $2,000 toward INV-103, which had $7,500 outstanding. The approved $500 credit memo also belongs to INV-103. INV-104 is a new $3,000 invoice with no payment yet.", "The table shows balances after the reviewed applications. An equal total alone would not justify assigning the ACH: verify payer identity, currency, remittance, and whether the receipt was already applied."],
        table: {
          caption: "Fictional invoice-level reconciliation, all amounts USD",
          headers: ["Invoice", "Opening AR", "New invoice", "Cash applied", "Credit", "Closing AR"],
          rows: [
            ["INV-101", "$3,000", "$0", "$3,000", "$0", "$0"],
            ["INV-102", "$1,500", "$0", "$1,500", "$0", "$0"],
            ["INV-103", "$7,500", "$0", "$2,000", "$500", "$5,000"],
            ["INV-104", "$0", "$3,000", "$0", "$0", "$3,000"],
            ["Total", "$12,000", "$3,000", "$6,500", "$500", "$8,000"],
          ],
        },
      },
      {
        heading: "3. Recalculate the closing accounts receivable balance",
        paragraphs: ["For these facts: opening AR + new invoices − applied receipts − credit memos = closing AR. Therefore $12,000 + $3,000 − $6,500 − $500 = $8,000. The remaining customer balances also total $8,000: $5,000 on INV-103 and $3,000 on INV-104.", "The partial payment does not close INV-103. The credit reduces the balance separately from cash. If an unidentified receipt or overpayment were present, track it separately and follow the accounting system's treatment; do not force it onto an unrelated invoice just to reduce the outstanding total."],
      },
      {
        heading: "4. Explain a difference from the general ledger",
        paragraphs: ["Suppose the AR control account shows $8,500 while the customer subledger shows $8,000. Inspection finds that the $500 credit memo is in the subledger but its accounting has not been transferred to the general ledger. The observed $500 difference is explained by that specific record, not by an assumed fee or a balancing adjustment.", "The authorized accounting team completes the missing posting through its normal process, checks for duplicates, and reruns both reports. In this example both then show $8,000. Other differences may require different action. Oracle's reconciliation documentation describes comparing beginning balances, period activity, and ending balances and investigating detailed differences; its report behavior is specific to Oracle."],
      },
      {
        heading: "5. Keep a closing record another person can follow",
        paragraphs: ["Save the report cutoffs, invoice applications, remittance references, credit memo ID, explanation of the $500 difference, and the final report comparison. Record who prepared and reviewed the reconciliation. A zero difference is useful only when the supporting applications and adjustments are also correct.", "InvoiceReconcile can help prepare and review the invoice-to-payment matching step from CSV or XLSX exports. Credit memo posting, the AR control-account comparison, and final accounting treatment remain in your accounting workflow. The examples here illustrate a method, not a claim that the app performs the entire month-end close."],
        bullets: ["Same entity, currency and cutoff", "Receipts linked to the intended invoices", "Partial balance preserved", "Credit memo independently supported", "Ledger difference investigated and reports rerun"],
      },
    ],
    takeaways: ["Reconcile both invoice detail and the closing total.", "Applied receipts and credits are different movements.", "Keep an unpaid remainder open.", "Explain ledger differences with specific source records.", "Payment matching does not replace the AR-to-GL reconciliation."],
    related: ["accounts-receivable-reconciliation-explained", "cash-application-explained-for-small-businesses", "invoice-reconciliation-checklist"],
    sources: [{ href: "https://docs.oracle.com/en/cloud/saas/financials/26b/ocuar/guidelines-for-using-the-receivables-to-general-ledger.html", label: "Oracle: Receivables to General Ledger Reconciliation report" }],
    nextSteps: [{ href: "/tools/lump-sum-invoice-matcher", label: "Try a combined payment" }, { href: "/app/demo", label: "Explore fictional sample data" }, { href: "/auth/sign-up", label: "Start a free workspace" }],
  },
  {
    slug: "how-to-reconcile-bank-deposits-with-invoices",
    title: "How to reconcile bank deposits with invoices: three worked cases",
    description: "Match a direct deposit, a combined customer payment, and a fee-net processor payout to invoices without hiding partials or unexplained differences.",
    category: "How-to",
    readingMinutes: 5,
    published: "2026-09-05",
    updated: "2026-09-05",
    intro: "Start by asking what the bank deposit represents: one customer's payment, several invoices paid together, or a processor settlement containing many transactions. Each needs a different evidence trail. These fictional USD examples show how to connect the deposit to invoices without treating every amount difference as a fee.",
    sections: [
      {
        heading: "1. Gather the deposit and the current invoice balances",
        paragraphs: ["Keep the bank transaction ID, posted date, amount, currency, payer description and full reference. Export open invoices with current balances and stable invoice IDs. A reused invoice export can propose a match to an invoice that has already been settled.", "For a processor payout, also obtain the settlement report. A bank description identifying the processor does not identify the individual customers. Keep the bank deposit separate from the customer receipts so that the same cash movement is not counted twice."],
      },
      {
        heading: "2. Direct payment: follow the reference, not just the amount",
        paragraphs: ["An ACH for $1,250 includes INV-410 in its memo. That invoice has $1,250 open for the same customer and currency. Check the payment date and duplicate status, then confirm the application with its source reference. The invoice has $0 remaining after this reviewed application.", "If another customer also owes $1,250, matching the first equal amount would be unsafe. If the invoice has only $1,000 open, the extra $250 needs separate review rather than an over-application."],
      },
      {
        heading: "3. Combined payment: one deposit can settle several invoices",
        paragraphs: ["A $4,725 deposit comes from a customer with open invoices for $1,500, $1,225, $2,000, $750 and $6,200. The first three sum to $4,725. The free lump-sum matcher below can test this exact example; customer remittance is still needed to confirm that these are the intended invoices.", "If multiple combinations produce the same total, ask for remittance or check invoice references and customer identity. If none fit, investigate missing invoices, prior credits, partial payments or a stale balance before changing the source amounts."],
        table: { caption: "Fictional combined payment", headers: ["Invoice", "Proposed application"], rows: [["INV-2108", "$1,500"], ["INV-2141", "$1,225"], ["INV-2190", "$2,000"], ["Total", "$4,725"]] },
      },
      {
        heading: "4. Processor payout: bridge gross receipts to net cash",
        paragraphs: ["Suppose a settlement report lists $5,000 of gross customer receipts and $150 of documented fees, with no other adjustments. The expected net deposit is $4,850. Match the gross customer receipts to their invoices and separately explain how that settlement reached the bank. Do not record a $150 customer shortfall merely because the bank received the net amount.", "Stripe's payout reconciliation report links automatic payouts to their underlying transaction batches and exposes gross, fee and net amounts. Other payout types and processors may require different reports. A matching percentage is not evidence of a fee: use the report for that specific settlement."],
      },
      {
        heading: "5. Keep unresolved deposits visible and verify the handoff",
        paragraphs: ["If the customer cannot be identified, retain the payment as unmatched with an owner and next action. If a settlement crosses month-end, document the timing rather than moving dates to make the totals agree. Review refunds, disputes and withheld amounts using their original records.", "For repeat work, import invoice and payment exports into InvoiceReconcile, inspect the suggested matches, review exceptions and export results. The app does not connect directly to your bank or automatically post the accounting entries. Verify the ledger and complete your broader bank reconciliation separately."],
        bullets: ["Preserve the original deposit ID", "Use current invoice balances", "Confirm the customer and currency", "Document fees using settlement evidence", "Leave unsupported allocations unresolved"],
      },
    ],
    takeaways: ["Identify whether the deposit is a customer receipt or a settlement.", "Use payer and reference evidence alongside the amount.", "Treat exact combinations as candidates, not proof.", "Separate gross customer receipts from net bank cash.", "Verify the accounting handoff and retain exceptions."],
    related: ["how-to-match-one-payment-to-multiple-invoices", "how-to-reconcile-processing-fees-against-invoices", "accounts-receivable-reconciliation-example"],
    sources: [{ href: "https://docs.stripe.com/reports/payout-reconciliation", label: "Stripe: payout reconciliation reports, gross, fee and net amounts" }],
    nextSteps: [{ href: "/tools/lump-sum-invoice-matcher", label: "Test the $4,725 example" }, { href: "/excel-invoice-reconciliation", label: "Download fictional CSV files" }, { href: "/auth/sign-up", label: "Match files in a free workspace" }],
  },
];
