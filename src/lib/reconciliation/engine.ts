import {
  DEFAULT_RECONCILIATION_CONFIG,
  type DuplicateFinding,
  type Invoice,
  type MatchEvidence,
  type MatchMethod,
  type PayerMappingRule,
  type Payment,
  type ProposedMatch,
  type ReconciliationConfig,
  type ReconciliationContext,
  type ReconciliationResult,
} from "./types";
import { canonicalInvoiceIdentity, canonicalPaymentIdentity } from "./identity";
import {
  buildPayerMappingIndex,
  payerMappingFor,
  ReconciliationCandidateIndex,
  type CandidateQuery,
  type PayerMappingIndex,
} from "./candidate-index";
import {
  dateDifferenceDays,
  nameSimilarity,
  paymentContainsInvoiceReference,
} from "./normalize";
import {
  acceptedFeeRule,
  descriptionRuleForInvoice,
  evaluateCustomRules,
  referenceRuleForInvoice,
  type PaymentRuleEvaluation,
  type PaymentRuleEvaluations,
} from "./custom-rules";
import type { DescriptionCustomerRule, ReferenceTemplateRule } from "./types";

interface Signals {
  reference: boolean;
  customerId: boolean;
  name: number;
  dateDays: number;
  dateEligible: boolean;
  account: boolean;
  payerMapping?: PayerMappingRule;
  descriptionMapping?: DescriptionCustomerRule;
  referenceTemplate?: ReferenceTemplateRule;
}

interface RankedInvoice {
  invoice: Invoice;
  signals: Signals;
  score: number;
}

function currency(value: string): string {
  return value.trim().toUpperCase();
}

function payerMappingEvidence(rule: PayerMappingRule): MatchEvidence {
  return {
    code: "payer_mapping_exact",
    message: `An active workspace rule maps payer "${rule.alias}" to ${rule.customerName}.`,
    strength: "strong",
    value: rule.customerName,
  };
}

function descriptionMappingEvidence(rule: DescriptionCustomerRule): MatchEvidence {
  return {
    code: "description_mapping_exact",
    message: `An active workspace rule maps description "${rule.sourcePattern}" to ${rule.customerName}.`,
    strength: "strong",
    value: rule.customerName,
  };
}

function referenceTemplateEvidence(rule: ReferenceTemplateRule): MatchEvidence {
  return {
    code: "reference_template_exact",
    message: `Workspace template "${rule.sourcePattern}" extracted this invoice reference from the payment text.`,
    strength: "strong",
    value: rule.sourcePattern,
  };
}

function strongestRuleEvidence(signals: Signals): MatchEvidence | undefined {
  if (signals.referenceTemplate) return referenceTemplateEvidence(signals.referenceTemplate);
  if (signals.descriptionMapping) return descriptionMappingEvidence(signals.descriptionMapping);
  if (signals.payerMapping) return payerMappingEvidence(signals.payerMapping);
  return undefined;
}

function signalsFor(
  payment: Payment,
  invoice: Invoice,
  config: ReconciliationConfig,
  mappings: PayerMappingIndex,
  customEvaluation?: PaymentRuleEvaluation,
): Signals {
  const dateDays = dateDifferenceDays(payment.paymentDate, invoice.invoiceDate);
  return {
    reference: paymentContainsInvoiceReference(payment, invoice),
    customerId: Boolean(payment.payerId && invoice.customerId && payment.payerId === invoice.customerId),
    name: nameSimilarity(payment.payerName, invoice.customerName),
    dateDays,
    dateEligible: dateDays >= -config.earlyPaymentAllowanceDays && dateDays <= config.dateWindowDays,
    account: Boolean(payment.accountId && invoice.accountId && payment.accountId === invoice.accountId),
    payerMapping: payerMappingFor(payment, invoice, mappings),
    descriptionMapping: descriptionRuleForInvoice(customEvaluation, invoice),
    referenceTemplate: referenceRuleForInvoice(customEvaluation, invoice),
  };
}

function identityStrong(signals: Signals, config: ReconciliationConfig): boolean {
  return signals.reference
    || Boolean(signals.referenceTemplate)
    || signals.customerId
    || Boolean(signals.payerMapping)
    || Boolean(signals.descriptionMapping)
    || signals.name >= config.minimumNameSimilarity;
}

function signalScore(signals: Signals): number {
  return (signals.reference ? 100 : 0)
    + (signals.customerId ? 55 : 0)
    + (signals.payerMapping ? 70 : 0)
    + (signals.descriptionMapping ? 65 : 0)
    + (signals.referenceTemplate ? 95 : 0)
    + signals.name * 35
    + (signals.dateEligible ? Math.max(0, 20 - Math.max(0, signals.dateDays) / 5) : 0)
    + (signals.account ? 10 : 0);
}

function evidenceFor(signals: Signals, amountCode: MatchEvidence["code"], amountMessage: string): MatchEvidence[] {
  const evidence: MatchEvidence[] = [{ code: amountCode, message: amountMessage, strength: "strong" }];
  if (signals.reference) {
    evidence.push({ code: "reference_exact", message: "The payment text contains the invoice reference.", strength: "strong" });
  }
  if (signals.referenceTemplate) {
    evidence.push(referenceTemplateEvidence(signals.referenceTemplate));
  }
  if (!signals.reference && !signals.referenceTemplate) {
    evidence.push({ code: "reference_missing", message: "No invoice reference was found in the payment text.", strength: "warning" });
  }
  if (signals.customerId) {
    evidence.push({ code: "customer_id_exact", message: "The payer and customer IDs match.", strength: "strong" });
  }
  if (signals.payerMapping) {
    evidence.push(payerMappingEvidence(signals.payerMapping));
  }
  if (signals.descriptionMapping) {
    evidence.push(descriptionMappingEvidence(signals.descriptionMapping));
  }
  if (signals.name === 1) {
    evidence.push({ code: "name_exact", message: "The normalized payer and customer names match.", strength: "strong" });
  } else if (signals.name > 0) {
    evidence.push({
      code: signals.name >= 0.68 ? "name_similar" : "name_mismatch",
      message: signals.name >= 0.68
        ? "The payer and customer names are similar after normalization."
        : "The payer name is not a strong match for the customer.",
      strength: signals.name >= 0.68 ? "supporting" : "warning",
      value: Number(signals.name.toFixed(2)),
    });
  }
  if (signals.dateEligible) {
    evidence.push({
      code: "date_close",
      message: `The payment date is ${Math.abs(signals.dateDays)} day${Math.abs(signals.dateDays) === 1 ? "" : "s"} from the invoice date.`,
      strength: "supporting",
      value: signals.dateDays,
    });
  } else {
    evidence.push({ code: "date_outside_window", message: "The payment is outside the configured date window.", strength: "warning", value: signals.dateDays });
  }
  if (signals.account) {
    evidence.push({ code: "account_exact", message: "The payment and invoice account IDs match.", strength: "supporting" });
  }
  evidence.push({ code: "currency_exact", message: "The payment and invoice currencies match.", strength: "strong" });
  return evidence;
}

function makeMatch(input: {
  method: MatchMethod;
  payments: Payment[];
  invoices: Invoice[];
  confidence: ProposedMatch["confidence"];
  evidence: MatchEvidence[];
  appliedAmountMinor: number;
  candidateInvoiceIds?: string[];
  requiresConfirmation?: boolean;
}): ProposedMatch {
  const paymentAmountMinor = input.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const invoiceAmountMinor = input.invoices.reduce((sum, invoice) => sum + invoice.outstandingAmountMinor, 0);
  return {
    id: `match:${input.method}:${input.payments.map((payment) => payment.id).join("+")}:${input.invoices.map((invoice) => invoice.id).join("+") || "none"}`,
    paymentIds: input.payments.map((payment) => payment.id),
    invoiceIds: input.invoices.map((invoice) => invoice.id),
    candidateInvoiceIds: input.candidateInvoiceIds,
    confidence: input.confidence,
    method: input.method,
    paymentAmountMinor,
    invoiceAmountMinor,
    appliedAmountMinor: input.appliedAmountMinor,
    discrepancyMinor: paymentAmountMinor - invoiceAmountMinor,
    remainingInvoiceBalanceMinor: Math.max(0, invoiceAmountMinor - input.appliedAmountMinor),
    unappliedPaymentMinor: Math.max(0, paymentAmountMinor - input.appliedAmountMinor),
    requiresConfirmation: input.requiresConfirmation ?? input.confidence !== "exact",
    reasons: input.evidence.map((item) => item.message),
    evidence: input.evidence,
  };
}

function detectDuplicatePayments(payments: Payment[]): { findings: DuplicateFinding[]; duplicateIds: Set<string> } {
  const groups = new Map<string, Payment[]>();
  for (const payment of payments) {
    const key = canonicalPaymentIdentity(payment);
    const group = groups.get(key) ?? [];
    group.push(payment);
    groups.set(key, group);
  }
  const findings: DuplicateFinding[] = [];
  const duplicateIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [canonical, ...duplicates] = group;
    duplicates.forEach((payment) => duplicateIds.add(payment.id));
    findings.push({
      kind: "payment",
      canonicalId: canonical.id,
      duplicateIds: duplicates.map((payment) => payment.id),
      reason: canonical.transactionId
        ? "The transactions share the same transaction ID."
        : "The transactions share the same date, amount, currency, reference and normalized payer.",
    });
  }
  return { findings, duplicateIds };
}

function detectDuplicateInvoices(invoices: Invoice[]): { findings: DuplicateFinding[]; duplicateIds: Set<string> } {
  const groups = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    const key = canonicalInvoiceIdentity(invoice);
    const group = groups.get(key) ?? [];
    group.push(invoice);
    groups.set(key, group);
  }
  const findings: DuplicateFinding[] = [];
  const duplicateIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [canonical, ...duplicates] = group;
    duplicates.forEach((invoice) => duplicateIds.add(invoice.id));
    findings.push({
      kind: "invoice",
      canonicalId: canonical.id,
      duplicateIds: duplicates.map((invoice) => invoice.id),
      reason: "The invoices share the same number, normalized customer, currency and original amount.",
    });
  }
  return { findings, duplicateIds };
}

function subsetSums<T>(
  items: T[],
  amount: (item: T) => number,
  target: number,
  maxSize: number,
  solutionLimit = 2,
): T[][] {
  const sorted = [...items].sort((left, right) => amount(right) - amount(left));
  const solutions: T[][] = [];
  let visited = 0;
  const nodeLimit = 50_000;

  function visit(index: number, total: number, selected: T[]): void {
    if (solutions.length >= solutionLimit || visited >= nodeLimit) return;
    visited += 1;
    if (total === target && selected.length >= 2) {
      solutions.push([...selected]);
      return;
    }
    if (total >= target || selected.length >= maxSize || index >= sorted.length) return;
    for (let cursor = index; cursor < sorted.length; cursor += 1) {
      const item = sorted[cursor];
      const itemAmount = amount(item);
      if (total + itemAmount > target) continue;
      selected.push(item);
      visit(cursor + 1, total + itemAmount, selected);
      selected.pop();
      if (solutions.length >= solutionLimit || visited >= nodeLimit) return;
    }
  }

  visit(0, 0, []);
  return solutions;
}

function rankedCandidates(
  payment: Payment,
  invoices: Invoice[],
  config: ReconciliationConfig,
  remaining: Map<string, number>,
  mappings: PayerMappingIndex,
  customEvaluations: PaymentRuleEvaluations,
): RankedInvoice[] {
  return invoices
    .filter((invoice) => (remaining.get(invoice.id) ?? 0) > 0 && currency(invoice.currency) === currency(payment.currency))
    .map((invoice) => {
      const signals = signalsFor(payment, invoice, config, mappings, customEvaluations.get(payment));
      return { invoice, signals, score: signalScore(signals) };
    })
    .filter((candidate) => candidate.signals.dateEligible || candidate.signals.reference)
    .sort((left, right) => right.score - left.score || left.invoice.id.localeCompare(right.invoice.id));
}

function candidateLimitMatch(
  payment: Payment,
  query: CandidateQuery<Invoice>,
  config: ReconciliationConfig,
  reason = "The candidate set is too large to evaluate safely in one deterministic pass.",
): ProposedMatch {
  const evidenceLimit = Number.isFinite(config.candidateEvidenceLimit)
    ? Math.max(1, Math.floor(config.candidateEvidenceLimit))
    : DEFAULT_RECONCILIATION_CONFIG.candidateEvidenceLimit;
  const evaluationLimit = Number.isFinite(config.candidateEvaluationLimit)
    ? Math.max(1, Math.floor(config.candidateEvaluationLimit))
    : DEFAULT_RECONCILIATION_CONFIG.candidateEvaluationLimit;
  return makeMatch({
    method: "ambiguous",
    payments: [payment],
    invoices: [],
    candidateInvoiceIds: query.items.slice(0, evidenceLimit).map((invoice) => invoice.id),
    confidence: "review",
    appliedAmountMinor: 0,
    requiresConfirmation: true,
    evidence: [
      { code: "multiple_candidates", message: reason, strength: "warning" },
      {
        code: "candidate_limit_exceeded",
        message: `At least ${query.minimumCandidateCount} candidates qualified, above the ${evaluationLimit} candidate safety limit. Narrow the import or add stronger payer and reference data before applying this payment.`,
        strength: "warning",
        value: query.minimumCandidateCount,
      },
    ],
  });
}

function consume(
  remaining: Map<string, number>,
  candidateIndex: ReconciliationCandidateIndex,
  invoices: Invoice[],
  appliedByInvoice?: number[],
): void {
  invoices.forEach((invoice, index) => {
    const balance = remaining.get(invoice.id) ?? invoice.outstandingAmountMinor;
    const applied = appliedByInvoice?.[index] ?? balance;
    candidateIndex.updateInvoiceBalance(invoice, Math.max(0, balance - applied));
  });
}

export function reconcile(
  invoices: Invoice[],
  payments: Payment[],
  overrides: Partial<ReconciliationConfig> = {},
  context: ReconciliationContext = {},
): ReconciliationResult {
  const config = { ...DEFAULT_RECONCILIATION_CONFIG, ...overrides };
  const mappings = buildPayerMappingIndex(context.payerMappings ?? []);
  const customEvaluations = evaluateCustomRules(payments, context.customRules ?? []);
  const duplicatePaymentResult = detectDuplicatePayments(payments);
  const duplicateInvoiceResult = detectDuplicateInvoices(invoices);
  const activeInvoices = invoices.filter((invoice) =>
    !duplicateInvoiceResult.duplicateIds.has(invoice.id)
    && (invoice.status === "open" || invoice.status === "partially_paid")
    && invoice.outstandingAmountMinor > 0,
  );
  const activePayments = payments.filter((payment) => !duplicatePaymentResult.duplicateIds.has(payment.id) && payment.amountMinor > 0);
  const remaining = new Map(activeInvoices.map((invoice) => [invoice.id, invoice.outstandingAmountMinor]));
  const candidateIndex = new ReconciliationCandidateIndex(activeInvoices, activePayments, remaining, mappings, customEvaluations);
  const allocatedPayments = new Set<string>();
  const overloadedPayments = new Map<string, CandidateQuery<Invoice>>();
  const overloadedGroupedInvoices = new Map<string, number>();
  const matches: ProposedMatch[] = [];
  const paymentsById = new Map<string, Payment>();
  payments.forEach((payment) => {
    if (!paymentsById.has(payment.id)) paymentsById.set(payment.id, payment);
  });

  for (const finding of duplicatePaymentResult.findings) {
    for (const duplicateId of finding.duplicateIds) {
      const payment = paymentsById.get(duplicateId)!;
      const canonical = paymentsById.get(finding.canonicalId)!;
      matches.push(makeMatch({
        method: "duplicate_payment",
        payments: [payment],
        invoices: [],
        confidence: "review",
        appliedAmountMinor: 0,
        requiresConfirmation: true,
        evidence: [{
          code: "duplicate_transaction",
          message: `This payment may duplicate payment ${canonical.id}. It has not been counted toward reconciliation.`,
          strength: "warning",
        }],
      }));
    }
  }

  // First reserve only strong one-to-one matches. Weak amount-only matches stay available for review.
  for (const payment of activePayments) {
    const exactBalanceQuery = candidateIndex.exactBalanceInvoices(payment, config, config.candidateEvaluationLimit);
    if (exactBalanceQuery.exceeded) {
      overloadedPayments.set(payment.id, exactBalanceQuery);
      candidateIndex.deactivatePayment(payment);
      continue;
    }
    const candidates = rankedCandidates(payment, exactBalanceQuery.items, config, remaining, mappings, customEvaluations)
      .filter((candidate) => (remaining.get(candidate.invoice.id) ?? 0) === payment.amountMinor);
    const strong = candidates.filter((candidate) => identityStrong(candidate.signals, config));
    if (strong.length === 0) continue;
    const best = strong[0];
    const tied = strong.filter((candidate) => Math.abs(candidate.score - best.score) < 5);
    if (tied.length > 1) continue;
    // Learned templates can propose transparent evidence, but only the native,
    // unambiguous invoice-reference signal may remove human confirmation.
    const confidence = best.signals.reference && best.signals.dateEligible ? "exact" : "high_confidence";
    matches.push(makeMatch({
      method: best.signals.reference || best.signals.referenceTemplate ? "reference_match" : "exact_one_to_one",
      payments: [payment],
      invoices: [best.invoice],
      confidence,
      appliedAmountMinor: payment.amountMinor,
      evidence: evidenceFor(best.signals, "amount_exact", "The payment amount exactly matches the outstanding invoice balance."),
    }));
    consume(remaining, candidateIndex, [best.invoice]);
    allocatedPayments.add(payment.id);
    candidateIndex.deactivatePayment(payment);
  }

  // Find one payment that exactly equals a bounded combination of invoices for the same responsible payer.
  for (const payment of activePayments) {
    if (allocatedPayments.has(payment.id) || overloadedPayments.has(payment.id)) continue;
    const identityQuery = candidateIndex.identityInvoices(payment, config, config.candidateEvaluationLimit);
    if (identityQuery.exceeded) {
      overloadedPayments.set(payment.id, identityQuery);
      candidateIndex.deactivatePayment(payment);
      continue;
    }
    const candidates = rankedCandidates(payment, identityQuery.items, config, remaining, mappings, customEvaluations)
      .filter((candidate) => identityStrong(candidate.signals, config) && (remaining.get(candidate.invoice.id) ?? 0) < payment.amountMinor)
      .slice(0, config.subsetCandidateLimit);
    const solutions = subsetSums(
      candidates,
      (candidate) => remaining.get(candidate.invoice.id) ?? 0,
      payment.amountMinor,
      config.subsetSizeLimit,
    );
    if (solutions.length === 0) continue;
    if (solutions.length > 1) {
      matches.push(makeMatch({
        method: "ambiguous",
        payments: [payment],
        invoices: [],
        candidateInvoiceIds: [...new Set(solutions.flat().map((candidate) => candidate.invoice.id))],
        confidence: "review",
        appliedAmountMinor: 0,
        evidence: [
          { code: "amount_combined", message: "More than one invoice combination equals the payment amount.", strength: "warning" },
          { code: "multiple_candidates", message: "Choose the intended invoice combination before applying this payment.", strength: "warning" },
        ],
      }));
      allocatedPayments.add(payment.id);
      candidateIndex.deactivatePayment(payment);
      continue;
    }
    const selected = solutions[0];
    const selectedInvoices = selected.map((candidate) => candidate.invoice);
    const allStrong = selected.every((candidate) => identityStrong(candidate.signals, config));
    const anyReference = selected.some((candidate) => candidate.signals.reference || candidate.signals.referenceTemplate);
    const allNativeReferences = selected.every((candidate) => candidate.signals.reference);
    const mappedPayer = selected.find((candidate) => candidate.signals.payerMapping)?.signals.payerMapping;
    const customRuleEvidence = selected.map((candidate) => strongestRuleEvidence(candidate.signals)).find(Boolean);
    const evidence: MatchEvidence[] = [
      { code: "amount_combined", message: `${selectedInvoices.length} invoice balances add up exactly to the payment amount.`, strength: "strong" },
      customRuleEvidence
        || (mappedPayer
        ? payerMappingEvidence(mappedPayer)
        : { code: anyReference ? "reference_exact" : "name_similar", message: anyReference ? "The payment text identifies at least one invoice in the combination." : "The payer matches the customers on the selected invoices.", strength: allStrong ? "strong" : "supporting" }),
      { code: "currency_exact", message: "All selected invoices use the payment currency.", strength: "strong" },
    ];
    matches.push(makeMatch({
      method: "combined_invoices",
      payments: [payment],
      invoices: selectedInvoices,
      confidence: allNativeReferences && selected.every((candidate) => candidate.signals.dateEligible) ? "exact" : "high_confidence",
      appliedAmountMinor: payment.amountMinor,
      evidence,
    }));
    consume(remaining, candidateIndex, selectedInvoices);
    allocatedPayments.add(payment.id);
    candidateIndex.deactivatePayment(payment);
  }

  // Find bounded groups of payments that settle one invoice in full.
  for (const invoice of activeInvoices) {
    const invoiceBalance = remaining.get(invoice.id) ?? 0;
    if (invoiceBalance <= 0) continue;
    const paymentQuery = candidateIndex.identityPayments(
      invoice,
      config,
      config.candidateEvaluationLimit,
      allocatedPayments,
    );
    if (paymentQuery.exceeded) {
      overloadedGroupedInvoices.set(invoice.id, paymentQuery.minimumCandidateCount);
      continue;
    }
    const candidates = paymentQuery.items
      .map((payment) => ({ payment, signals: signalsFor(payment, invoice, config, mappings, customEvaluations.get(payment)) }))
      .filter((candidate) => (candidate.signals.dateEligible || candidate.signals.reference) && identityStrong(candidate.signals, config))
      .sort((left, right) => signalScore(right.signals) - signalScore(left.signals) || left.payment.id.localeCompare(right.payment.id))
      .slice(0, config.groupedPaymentCandidateLimit);
    const solutions = subsetSums(candidates, (candidate) => candidate.payment.amountMinor, invoiceBalance, config.groupedPaymentSizeLimit);
    if (solutions.length !== 1) continue;
    const selected = solutions[0];
    const selectedPayments = selected.map((candidate) => candidate.payment);
    const mappedPayer = selected.find((candidate) => candidate.signals.payerMapping)?.signals.payerMapping;
    const customRuleEvidence = selected.map((candidate) => strongestRuleEvidence(candidate.signals)).find(Boolean);
    matches.push(makeMatch({
      method: "grouped_payments",
      payments: selectedPayments,
      invoices: [invoice],
      confidence: selected.every((candidate) => candidate.signals.reference) ? "exact" : "high_confidence",
      appliedAmountMinor: invoiceBalance,
      evidence: [
        { code: "amount_combined", message: `${selectedPayments.length} payments add up exactly to the outstanding invoice balance.`, strength: "strong" },
        customRuleEvidence
          || (mappedPayer
          ? payerMappingEvidence(mappedPayer)
          : { code: "name_similar", message: "The payer identity is consistent with the invoice customer across the payment group.", strength: "strong" }),
        { code: "currency_exact", message: "All grouped payments use the invoice currency.", strength: "strong" },
      ],
    }));
    consume(remaining, candidateIndex, [invoice]);
    selectedPayments.forEach((payment) => {
      allocatedPayments.add(payment.id);
      candidateIndex.deactivatePayment(payment);
    });
  }

  for (const payment of activePayments) {
    if (allocatedPayments.has(payment.id)) continue;
    const overloaded = overloadedPayments.get(payment.id);
    if (overloaded) {
      matches.push(candidateLimitMatch(payment, overloaded, config));
      continue;
    }
    const crossCurrencyQuery = candidateIndex.crossCurrencyIdentityInvoices(payment, config.candidateEvaluationLimit);
    if (crossCurrencyQuery.exceeded) {
      matches.push(candidateLimitMatch(payment, crossCurrencyQuery, config, "Too many cross-currency identity candidates require review."));
      continue;
    }
    const crossCurrency = crossCurrencyQuery.items
      .map((invoice) => ({ invoice, signals: signalsFor(payment, invoice, config, mappings, customEvaluations.get(payment)) }))
      .filter((candidate) => candidate.signals.reference || candidate.signals.referenceTemplate || candidate.signals.payerMapping || candidate.signals.descriptionMapping || candidate.signals.name >= config.minimumNameSimilarity)
      .sort((left, right) => signalScore(right.signals) - signalScore(left.signals))[0];
    const candidateQuery = candidateIndex.allEligibleInvoices(payment, config, config.candidateEvaluationLimit);
    if (candidateQuery.exceeded && !crossCurrency?.signals.reference) {
      matches.push(candidateLimitMatch(payment, candidateQuery, config));
      continue;
    }
    const candidates = rankedCandidates(payment, candidateQuery.items, config, remaining, mappings, customEvaluations);
    if (crossCurrency && (crossCurrency.signals.reference || crossCurrency.signals.referenceTemplate || candidates.length === 0)) {
      matches.push(makeMatch({
        method: "currency_mismatch",
        payments: [payment],
        invoices: [crossCurrency.invoice],
        confidence: "unmatched",
        appliedAmountMinor: 0,
        candidateInvoiceIds: [crossCurrency.invoice.id],
        evidence: [{
          code: "currency_mismatch",
          message: `The payment is ${currency(payment.currency)} and the likely invoice is ${currency(crossCurrency.invoice.currency)}. Automatic reconciliation is blocked.`,
          strength: "warning",
        }],
      }));
      continue;
    }

    const exact = candidates.filter((candidate) => (remaining.get(candidate.invoice.id) ?? 0) === payment.amountMinor);
    if (exact.length > 1 && Math.abs(exact[0].score - exact[1].score) < 5) {
      matches.push(makeMatch({
        method: "ambiguous",
        payments: [payment],
        invoices: [],
        candidateInvoiceIds: exact.map((candidate) => candidate.invoice.id),
        confidence: "review",
        appliedAmountMinor: 0,
        evidence: [
          { code: "amount_exact", message: "The payment amount matches more than one open invoice.", strength: "strong" },
          { code: "multiple_candidates", message: "The available signals do not identify one responsible invoice.", strength: "warning" },
        ],
      }));
      continue;
    }

    const best = candidates[0];
    if (!best) {
      matches.push(makeMatch({
        method: "unmatched",
        payments: [payment],
        invoices: [],
        confidence: "unmatched",
        appliedAmountMinor: 0,
        evidence: [{ code: "no_candidate", message: "No responsible invoice candidate was found within the date window and currency.", strength: "warning" }],
      }));
      continue;
    }

    const groupedCandidateCount = overloadedGroupedInvoices.get(best.invoice.id);
    if (groupedCandidateCount) {
      matches.push(candidateLimitMatch(payment, {
        exceeded: true,
        items: [best.invoice],
        minimumCandidateCount: groupedCandidateCount,
      }, config, "This invoice has too many responsible payment candidates to evaluate grouped settlement safely."));
      continue;
    }

    const balance = remaining.get(best.invoice.id) ?? best.invoice.outstandingAmountMinor;
    const strongIdentity = identityStrong(best.signals, config);
    if (payment.amountMinor === balance) {
      matches.push(makeMatch({
        method: best.signals.reference || best.signals.referenceTemplate ? "reference_match" : "exact_one_to_one",
        payments: [payment],
        invoices: [best.invoice],
        confidence: "review",
        appliedAmountMinor: payment.amountMinor,
        evidence: evidenceFor(best.signals, "amount_exact", "The payment amount exactly matches the outstanding invoice balance, but the identity signals need review."),
      }));
      consume(remaining, candidateIndex, [best.invoice]);
      continue;
    }

    if (!strongIdentity) {
      matches.push(makeMatch({
        method: "unmatched",
        payments: [payment],
        invoices: [],
        candidateInvoiceIds: [best.invoice.id],
        confidence: "unmatched",
        appliedAmountMinor: 0,
        evidence: [{ code: "no_candidate", message: "An invoice is nearby, but payer or reference evidence is not strong enough to suggest applying the payment.", strength: "warning" }],
      }));
      continue;
    }

    if (payment.amountMinor < balance) {
      const shortage = balance - payment.amountMinor;
      const feeLimit = Math.min(config.maximumFeeMinor, Math.round(balance * config.feeTolerancePercent));
      const isPossibleFee = shortage > 0 && shortage <= feeLimit;
      const feeRule = isPossibleFee
        ? acceptedFeeRule(customEvaluations.get(payment), balance, shortage, config)
        : undefined;
      const feeEvidence = feeRule ? [{
        code: "fee_behavior_review" as const,
        message: `Workspace fee rule "${feeRule.sourcePattern}" recognizes this payment descriptor. Confirm the actual fee or deduction before recording it.`,
        strength: "supporting" as const,
        value: shortage,
      }] : [];
      matches.push(makeMatch({
        method: isPossibleFee ? "possible_fee_or_deduction" : "partial_payment",
        payments: [payment],
        invoices: [{ ...best.invoice, outstandingAmountMinor: balance }],
        confidence: "review",
        appliedAmountMinor: payment.amountMinor,
        evidence: [...evidenceFor(
          best.signals,
          isPossibleFee ? "amount_short" : "amount_partial",
          isPossibleFee
            ? `The payment is short by ${shortage} minor currency units. This may be a deduction or processing fee and requires confirmation.`
            : `The payment would partially apply to the invoice, leaving ${shortage} minor currency units outstanding.`,
        ), ...feeEvidence],
      }));
      consume(remaining, candidateIndex, [best.invoice], [payment.amountMinor]);
      continue;
    }

    const overage = payment.amountMinor - balance;
    if (overage <= Math.round(balance * config.overpaymentTolerancePercent) || best.signals.reference) {
      matches.push(makeMatch({
        method: "overpayment",
        payments: [payment],
        invoices: [{ ...best.invoice, outstandingAmountMinor: balance }],
        confidence: "review",
        appliedAmountMinor: balance,
        evidence: evidenceFor(best.signals, "amount_over", `The payment exceeds the invoice balance by ${overage} minor currency units, which would remain unapplied.`),
      }));
      consume(remaining, candidateIndex, [best.invoice]);
      continue;
    }

    matches.push(makeMatch({
      method: "unmatched",
      payments: [payment],
      invoices: [],
      candidateInvoiceIds: [best.invoice.id],
      confidence: "unmatched",
      appliedAmountMinor: 0,
      evidence: [{ code: "no_candidate", message: "The likely invoice amount differs too much from the payment for a responsible suggestion.", strength: "warning" }],
    }));
  }

  return {
    matches,
    duplicatePayments: duplicatePaymentResult.findings,
    duplicateInvoices: duplicateInvoiceResult.findings,
    unallocatedInvoiceIds: activeInvoices.filter((invoice) => (remaining.get(invoice.id) ?? 0) > 0).map((invoice) => invoice.id),
  };
}

export { detectDuplicateInvoices, detectDuplicatePayments, subsetSums };
