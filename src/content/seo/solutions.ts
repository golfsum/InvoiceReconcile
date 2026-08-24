import type { AudiencePage } from "./types";

export const solutionPages: Record<string, AudiencePage> = {
  bookkeepers: {
    slug: "bookkeepers",
    title: "A payment reconciliation workspace built for bookkeepers",
    metaTitle: "Invoice Reconciliation for Bookkeepers | InvoiceReconcile",
    description: "Review incoming payment exceptions across client-scoped workspaces with isolated imports, decisions, and audit history.",
    eyebrow: "Solution for bookkeepers",
    intro: "Move from client folder to client folder without rebuilding the reconciliation method. Each workspace keeps its invoice and payment records, decisions, and exports separate while the portfolio view shows where work remains.",
    painPoints: [
      { title: "Changing source files", detail: "One client exports QuickBooks, another sends an Excel workbook, and a third has a processor CSV with different headers each month." },
      { title: "Repeated identity lookup", detail: "Bank descriptions rarely match the customer display name exactly, so useful aliases need to be saved by client." },
      { title: "Scattered sign-off", detail: "Email, spreadsheet notes, and accounting records make it difficult to reconstruct who approved a difficult application." },
    ],
    workflow: [
      { title: "Choose the client", detail: "Open the correct isolated workspace and confirm the reconciliation period." },
      { title: "Import two files", detail: "Preview the open invoice and incoming payment columns before processing." },
      { title: "Review exceptions", detail: "Work only the partials, lump sums, fees, duplicates, and ambiguous matches." },
      { title: "Confirm and export", detail: "Create an audit event for each decision and deliver a clean result to the accounting workflow." },
    ],
    example: {
      label: "Monday morning client queue",
      payment: "18 need review",
      invoices: ["Acme Plumbing  11", "Bright Dental  7", "Smith Electric  0"],
      outcome: "Start with active exceptions",
      note: "Operational counts help route the work. Financial values and source details remain inside the client workspace.",
    },
    controls: ["Organization and workspace access enforced on the server", "Column mapping preview before every import", "Original payer and reference evidence remains visible", "Audit events for persisted confirmations, rejections, and notes", "No automatic write-back to an accounting ledger", "Portfolio summary based on operational counts"],
    related: [{ href: "/invoice-reconciliation-for-bookkeepers", label: "Bookkeeper reconciliation guide" }, { href: "/industries/bookkeepers", label: "Bookkeeping practice workflow" }, { href: "/tools/reconciliation-time-calculator", label: "Estimate manual effort" }],
  },
  "accounting-firms": {
    slug: "accounting-firms",
    title: "Standardize incoming payment reconciliation across client teams",
    metaTitle: "Payment Reconciliation for Accounting Firms | InvoiceReconcile",
    description: "Give accounting teams one review standard for incoming payment matches while keeping client data, rules, and access isolated.",
    eyebrow: "Solution for accounting firms",
    intro: "A consistent evidence panel and decision workflow can improve review quality across engagements. Client source files and learned mappings stay separated, while engagement leads can see operational progress and recurring exception types.",
    painPoints: [
      { title: "Engagement variation", detail: "Clients use different accounting systems, processors, bank exports, naming conventions, and close calendars." },
      { title: "Review inconsistency", detail: "One preparer documents a grouped deposit carefully while another leaves only a cell comment with no source reference." },
      { title: "Capacity visibility", detail: "Leads need to know which client queues are blocked without opening sensitive transaction details." },
    ],
    workflow: [
      { title: "Define the review policy", detail: "Agree on confidence labels, evidence requirements, material exceptions, and sign-off roles." },
      { title: "Import by workspace", detail: "Preview each client file and correct uncertain columns while preserving one firm-wide process." },
      { title: "Assign exceptions", detail: "Route ambiguous payments and source-file errors to a named reviewer." },
      { title: "Verify the handoff", detail: "Export confirmed applications, reconcile control totals, and verify the client ledger." },
    ],
    example: {
      label: "Engagement review",
      payment: "$12,300.00 ACH",
      invoices: ["INV-1448  $7,300.00", "INV-1452  $5,000.00"],
      outcome: "Exact combined amount",
      note: "The preparer confirms payer and reference evidence. The audit trail lets the reviewer inspect the same facts without recreating the search.",
    },
    controls: ["Client-level row isolation and role checks", "Stable evidence layout across all engagements", "Source file lineage on each reconciliation", "Explicit prepared and confirmed states", "Aggregate admin metrics without customer financial payloads", "Exported unresolved items with owners"],
    related: [{ href: "/payment-reconciliation-for-accounting-firms", label: "Accounting firm reconciliation guide" }, { href: "/industries/accounting-firms", label: "Firm operating model" }, { href: "/resources/invoice-reconciliation-checklist", label: "Review checklist" }],
  },
  "small-business": {
    slug: "small-business",
    title: "Reconcile customer payments without a long implementation",
    metaTitle: "Payment Reconciliation for Small Business | InvoiceReconcile",
    description: "Import current invoice and payment files, clear obvious matches, and review only the deposits that need a decision.",
    eyebrow: "Solution for small business",
    intro: "Use the files your team already exports. InvoiceReconcile compares incoming payments with open invoices, explains suggested matches, and keeps partials, fees, grouped deposits, and missing references visible for review.",
    painPoints: [
      { title: "Payments arrive everywhere", detail: "Customers pay by ACH, wire, check, or a processor that does not always produce a clean link to the invoice." },
      { title: "The owner becomes the lookup table", detail: "One person remembers payer aliases and unusual customer habits, creating a bottleneck every close." },
      { title: "Exceptions stay hidden", detail: "An unexplained difference may be marked paid or left in a spreadsheet without a clear next action." },
    ],
    workflow: [
      { title: "Start with sample data", detail: "See exact, partial, combined, fee, duplicate, and unmatched cases before using business records." },
      { title: "Upload exports", detail: "Map invoice and payment columns with a preview and clear validation errors." },
      { title: "Check the evidence", detail: "Confirm exact suggestions and investigate the smaller exception list." },
      { title: "Export confirmed work", detail: "Keep the accounting system as the final ledger and verify every handoff." },
    ],
    example: {
      label: "Fee-net deposit",
      payment: "$4,850.00",
      invoices: ["INV-5002  $5,000.00"],
      outcome: "Review $150.00 difference",
      note: "The software does not assume a fee. A person checks the processor report or customer remittance before confirming the treatment.",
    },
    controls: ["No credit card required for the free plan", "CSV and XLSX testing without an integration", "Original source values preserved", "No automatic changes to the books", "Verified data export and deletion requests through support", "Clear unmatched and discrepancy reports"],
    related: [{ href: "/payment-reconciliation-for-small-business", label: "Small business reconciliation guide" }, { href: "/resources/cash-application-explained-for-small-businesses", label: "Cash application basics" }, { href: "/tools/invoice-payment-matcher", label: "Try the free matcher" }],
  },
};

export const solutionSlugs = Object.keys(solutionPages);
