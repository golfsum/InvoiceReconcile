import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";
import type { WorkspaceDecision } from "@/lib/reconciliation/workspace-data";

export const RECONCILIATION_EXPORT_HEADERS = [
  "Match ID",
  "Payment IDs",
  "Payment transaction IDs",
  "Payment dates",
  "Payers",
  "Payment amounts",
  "Payment currencies",
  "Payment references",
  "Payment source import IDs",
  "Payment details (JSON, minor units)",
  "Suggested invoice IDs",
  "Suggested invoice numbers",
  "Suggested customers",
  "Suggested invoice source import IDs",
  "Suggested invoice details (JSON, minor units)",
  "Candidate invoice IDs",
  "Candidate invoice numbers",
  "Candidate invoice details (JSON, minor units)",
  "Decision invoice IDs",
  "Decision invoice numbers",
  "Decision invoice details (JSON, minor units)",
  "Method",
  "Confidence",
  "Requires confirmation",
  "Decision",
  "Decision date",
  "Match currency",
  "Match payment amount",
  "Match invoice amount",
  "Proposed applied amount",
  "Confirmed applied amount",
  "Known unapplied payment amount",
  "Proposed remaining invoice balance",
  "Current suggested invoice outstanding amount",
  "Current decision invoice outstanding amount",
  "Difference",
  "Recorded fee or deduction",
  "Reasons",
  "Evidence (JSON)",
  "Review note",
  "Match feedback",
] as const;

type ReconciliationExportInput = {
  matches: ProposedMatch[];
  invoices: Invoice[];
  payments: Payment[];
  decisions?: Record<string, WorkspaceDecision>;
};

function joined(values: Array<string | number | undefined>) {
  return values.map((value) => value ?? "").join(" | ");
}

function paymentDetail(id: string, payment?: Payment) {
  if (!payment) return { id, unavailable: true };
  return {
    id: payment.id,
    transactionId: payment.transactionId,
    paymentDate: payment.paymentDate,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    payerName: payment.payerName,
    payerId: payment.payerId,
    description: payment.description,
    bankReference: payment.bankReference,
    achId: payment.achId,
    wireId: payment.wireId,
    memo: payment.memo,
    accountId: payment.accountId,
    sourceImportId: payment.sourceImportId,
    sourceRow: payment.sourceRow,
  };
}

function invoiceDetail(id: string, invoice?: Invoice) {
  if (!invoice) return { id, unavailable: true };
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
    customerId: invoice.customerId,
    customerEmail: invoice.customerEmail,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    originalAmountMinor: invoice.originalAmountMinor,
    currentOutstandingAmountMinor: invoice.outstandingAmountMinor,
    currency: invoice.currency,
    status: invoice.status,
    reference: invoice.reference,
    purchaseOrder: invoice.purchaseOrder,
    memo: invoice.memo,
    accountId: invoice.accountId,
    sourceImportId: invoice.sourceImportId,
    sourceRow: invoice.sourceRow,
  };
}

function paymentReference(payment: Payment) {
  return [payment.bankReference, payment.achId, payment.wireId].filter(Boolean).join(" / ");
}

function currentInvoiceBalance(ids: string[], invoiceById: Map<string, Invoice>) {
  if (!ids.length) return undefined;
  const invoices = ids.map((id) => invoiceById.get(id));
  if (invoices.some((invoice) => !invoice)) return undefined;
  return invoices.reduce((total, invoice) => total + (invoice?.outstandingAmountMinor ?? 0), 0);
}

function knownUnappliedAmount(match: ProposedMatch, decision?: WorkspaceDecision) {
  if (!decision) return match.unappliedPaymentMinor;
  if (decision.outcome !== "confirmed") return match.paymentAmountMinor;
  if (decision.appliedAmountMinor === undefined) return undefined;
  return Math.max(0, match.paymentAmountMinor - decision.appliedAmountMinor);
}

export function buildReconciliationExportRows({
  matches,
  invoices,
  payments,
  decisions = {},
}: ReconciliationExportInput): unknown[][] {
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

  return [
    [...RECONCILIATION_EXPORT_HEADERS],
    ...matches.map((match) => {
      const decision = decisions[match.id];
      const matchedPayments = match.paymentIds.map((id) => paymentById.get(id));
      const availablePayments = matchedPayments.filter((payment): payment is Payment => Boolean(payment));
      const suggestedInvoices = match.invoiceIds.map((id) => invoiceById.get(id));
      const availableSuggestedInvoices = suggestedInvoices.filter((invoice): invoice is Invoice => Boolean(invoice));
      const candidateInvoiceIds = match.candidateInvoiceIds ?? [];
      const candidateInvoices = candidateInvoiceIds.map((id) => invoiceById.get(id));
      const decisionInvoiceIds = decision?.invoiceIds ?? [];
      const decisionInvoices = decisionInvoiceIds.map((id) => invoiceById.get(id));
      const confirmedAppliedAmount = decision?.outcome === "confirmed" ? decision.appliedAmountMinor : undefined;
      const unappliedAmount = knownUnappliedAmount(match, decision);
      const suggestedInvoiceBalance = currentInvoiceBalance(match.invoiceIds, invoiceById);
      const decisionInvoiceBalance = currentInvoiceBalance(decisionInvoiceIds, invoiceById);
      const currencies = [...new Set([
        ...availablePayments.map((payment) => payment.currency),
        ...availableSuggestedInvoices.map((invoice) => invoice.currency),
      ])];

      return [
        match.id,
        joined(match.paymentIds),
        joined(matchedPayments.map((payment) => payment?.transactionId)),
        joined(matchedPayments.map((payment) => payment?.paymentDate)),
        joined(matchedPayments.map((payment) => payment?.payerName)),
        joined(matchedPayments.map((payment) => payment ? payment.amountMinor / 100 : undefined)),
        joined(matchedPayments.map((payment) => payment?.currency)),
        joined(matchedPayments.map((payment) => payment ? paymentReference(payment) : undefined)),
        joined(matchedPayments.map((payment) => payment?.sourceImportId)),
        JSON.stringify(match.paymentIds.map((id, index) => paymentDetail(id, matchedPayments[index]))),
        joined(match.invoiceIds),
        joined(suggestedInvoices.map((invoice) => invoice?.invoiceNumber)),
        joined(suggestedInvoices.map((invoice) => invoice?.customerName)),
        joined(suggestedInvoices.map((invoice) => invoice?.sourceImportId)),
        JSON.stringify(match.invoiceIds.map((id, index) => invoiceDetail(id, suggestedInvoices[index]))),
        joined(candidateInvoiceIds),
        joined(candidateInvoices.map((invoice) => invoice?.invoiceNumber)),
        JSON.stringify(candidateInvoiceIds.map((id, index) => invoiceDetail(id, candidateInvoices[index]))),
        joined(decisionInvoiceIds),
        joined(decisionInvoices.map((invoice) => invoice?.invoiceNumber)),
        JSON.stringify(decisionInvoiceIds.map((id, index) => invoiceDetail(id, decisionInvoices[index]))),
        match.method,
        match.confidence,
        match.requiresConfirmation,
        decision?.outcome ?? "pending_review",
        decision?.decidedAt ?? "",
        joined(currencies),
        match.paymentAmountMinor / 100,
        match.invoiceAmountMinor / 100,
        match.appliedAmountMinor / 100,
        confirmedAppliedAmount === undefined ? "" : confirmedAppliedAmount / 100,
        unappliedAmount === undefined ? "" : unappliedAmount / 100,
        match.remainingInvoiceBalanceMinor / 100,
        suggestedInvoiceBalance === undefined ? "" : suggestedInvoiceBalance / 100,
        decisionInvoiceBalance === undefined ? "" : decisionInvoiceBalance / 100,
        match.discrepancyMinor / 100,
        decision?.feeMinor === undefined ? "" : decision.feeMinor / 100,
        match.reasons.join(" | "),
        JSON.stringify(match.evidence),
        decision?.note ?? "",
        decision?.feedback ?? "",
      ];
    }),
  ];
}
