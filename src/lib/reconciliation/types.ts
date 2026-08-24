export type CurrencyCode = string;

export type InvoiceStatus = "open" | "partially_paid" | "paid" | "void";

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerId?: string;
  customerEmail?: string;
  invoiceDate: string;
  dueDate?: string;
  originalAmountMinor: number;
  outstandingAmountMinor: number;
  currency: CurrencyCode;
  status: InvoiceStatus;
  reference?: string;
  purchaseOrder?: string;
  memo?: string;
  accountId?: string;
  sourceImportId?: string;
  sourceRow?: number;
}

export interface Payment {
  id: string;
  paymentDate: string;
  amountMinor: number;
  currency: CurrencyCode;
  payerName?: string;
  payerId?: string;
  description?: string;
  bankReference?: string;
  achId?: string;
  wireId?: string;
  memo?: string;
  transactionId?: string;
  accountId?: string;
  sourceImportId?: string;
  sourceRow?: number;
}

export interface PayerMappingRule {
  id: string;
  alias: string;
  normalizedAlias: string;
  customerId: string;
  customerName: string;
  customerExternalId?: string;
}

export interface DescriptionCustomerRule {
  id: string;
  kind: "description_customer";
  sourcePattern: string;
  normalizedPattern: string;
  customerId: string;
  customerName: string;
  customerExternalId?: string;
  createdAt?: string;
}

export interface ReferenceTemplateRule {
  id: string;
  kind: "reference_template";
  sourcePattern: string;
  normalizedPattern: string;
  createdAt?: string;
}

export interface AcceptedFeeBehaviorRule {
  id: string;
  kind: "accepted_fee_behavior";
  sourcePattern: string;
  normalizedPattern: string;
  maximumFeeMinor: number;
  maximumFeeBasisPoints: number;
  createdAt?: string;
}

export type CustomMatchingRule =
  | DescriptionCustomerRule
  | ReferenceTemplateRule
  | AcceptedFeeBehaviorRule;

export type ConfidenceCategory =
  | "exact"
  | "high_confidence"
  | "review"
  | "unmatched";

export type MatchMethod =
  | "exact_one_to_one"
  | "reference_match"
  | "combined_invoices"
  | "grouped_payments"
  | "partial_payment"
  | "overpayment"
  | "possible_fee_or_deduction"
  | "ambiguous"
  | "duplicate_payment"
  | "currency_mismatch"
  | "unmatched";

export type EvidenceCode =
  | "amount_exact"
  | "amount_combined"
  | "amount_partial"
  | "amount_over"
  | "amount_short"
  | "reference_exact"
  | "reference_missing"
  | "name_exact"
  | "name_similar"
  | "name_mismatch"
  | "customer_id_exact"
  | "payer_mapping_exact"
  | "description_mapping_exact"
  | "reference_template_exact"
  | "fee_behavior_review"
  | "date_close"
  | "date_outside_window"
  | "account_exact"
  | "currency_exact"
  | "currency_mismatch"
  | "duplicate_transaction"
  | "candidate_limit_exceeded"
  | "multiple_candidates"
  | "no_candidate";

export interface MatchEvidence {
  code: EvidenceCode;
  message: string;
  strength: "strong" | "supporting" | "warning";
  value?: string | number;
}

export interface ProposedMatch {
  id: string;
  paymentIds: string[];
  invoiceIds: string[];
  candidateInvoiceIds?: string[];
  confidence: ConfidenceCategory;
  method: MatchMethod;
  paymentAmountMinor: number;
  invoiceAmountMinor: number;
  appliedAmountMinor: number;
  discrepancyMinor: number;
  remainingInvoiceBalanceMinor: number;
  unappliedPaymentMinor: number;
  requiresConfirmation: boolean;
  reasons: string[];
  evidence: MatchEvidence[];
}

export interface DuplicateFinding {
  kind: "payment" | "invoice";
  canonicalId: string;
  duplicateIds: string[];
  reason: string;
}

export interface ReconciliationConfig {
  dateWindowDays: number;
  earlyPaymentAllowanceDays: number;
  candidateEvaluationLimit: number;
  candidateEvidenceLimit: number;
  subsetCandidateLimit: number;
  subsetSizeLimit: number;
  groupedPaymentCandidateLimit: number;
  groupedPaymentSizeLimit: number;
  minimumNameSimilarity: number;
  feeTolerancePercent: number;
  maximumFeeMinor: number;
  overpaymentTolerancePercent: number;
}

export interface ReconciliationContext {
  payerMappings?: PayerMappingRule[];
  customRules?: CustomMatchingRule[];
}

export interface ReconciliationResult {
  matches: ProposedMatch[];
  duplicatePayments: DuplicateFinding[];
  duplicateInvoices: DuplicateFinding[];
  unallocatedInvoiceIds: string[];
}

export const DEFAULT_RECONCILIATION_CONFIG: ReconciliationConfig = {
  dateWindowDays: 90,
  earlyPaymentAllowanceDays: 3,
  candidateEvaluationLimit: 256,
  candidateEvidenceLimit: 25,
  subsetCandidateLimit: 18,
  subsetSizeLimit: 6,
  groupedPaymentCandidateLimit: 12,
  groupedPaymentSizeLimit: 6,
  minimumNameSimilarity: 0.68,
  feeTolerancePercent: 0.05,
  maximumFeeMinor: 25_000,
  overpaymentTolerancePercent: 0.2,
};
