import type {
  AcceptedFeeBehaviorRule,
  CustomMatchingRule,
  DescriptionCustomerRule,
  Invoice,
  Payment,
  ReconciliationConfig,
  ReferenceTemplateRule,
} from "./types";
import { invoiceReferences, normalizeEntityName, normalizeReference } from "./normalize";

const MAX_RULE_TEXT_LENGTH = 2_000;
const REFERENCE_TEMPLATE_TOKEN = /\{(DIGITS|ALNUM)\}/g;
const SAFE_REFERENCE_TEMPLATE = /^[A-Z0-9 ._/#:-]*\{(?:DIGITS|ALNUM)\}[A-Z0-9 ._/#:-]*$/;
const SAFE_RULE_SOURCE = /^[ -~]+$/;

export type PaymentRuleEvaluation = {
  descriptionMappings: DescriptionCustomerRule[];
  extractedReferences: Array<{ rule: ReferenceTemplateRule; reference: string }>;
  feeBehaviors: AcceptedFeeBehaviorRule[];
};

export type PaymentRuleEvaluations = ReadonlyMap<Payment, PaymentRuleEvaluation>;

function canonicalWhitespace(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function canonicalReferenceTemplate(value: string): string | null {
  if (!SAFE_RULE_SOURCE.test(value)) return null;
  const canonical = canonicalWhitespace(value);
  if (canonical.length < 4 || canonical.length > 80 || !SAFE_REFERENCE_TEMPLATE.test(canonical)) return null;
  const tokens = [...canonical.matchAll(REFERENCE_TEMPLATE_TOKEN)];
  if (tokens.length !== 1) return null;
  const literal = canonical.replace(REFERENCE_TEMPLATE_TOKEN, "").replace(/[^A-Z0-9]/g, "");
  return literal.length >= 2 ? canonical : null;
}

export function canonicalDescriptionPattern(value: string): string | null {
  if (!SAFE_RULE_SOURCE.test(value)) return null;
  const normalized = normalizeEntityName(value);
  return normalized.length >= 4 && normalized.length <= 120 ? normalized : null;
}

function paymentDescriptionText(payment: Payment) {
  return normalizeEntityName([
    payment.description,
    payment.bankReference,
    payment.memo,
  ].filter(Boolean).join(" ")).slice(0, MAX_RULE_TEXT_LENGTH);
}

function paymentReferenceText(payment: Payment) {
  return [
    payment.description,
    payment.bankReference,
    payment.achId,
    payment.wireId,
    payment.memo,
    payment.transactionId,
  ]
    .filter(Boolean)
    .join(" | ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .slice(0, MAX_RULE_TEXT_LENGTH);
}

function literalContains(text: string, pattern: string) {
  if (!text || !pattern) return false;
  return ` ${text} `.includes(` ${pattern} `);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function referenceTemplateRegex(rule: ReferenceTemplateRule): RegExp | null {
  const template = canonicalReferenceTemplate(rule.normalizedPattern || rule.sourcePattern);
  if (!template) return null;
  const token = template.includes("{DIGITS}") ? "{DIGITS}" : "{ALNUM}";
  const [prefix, suffix] = template.split(token);
  const capture = token === "{DIGITS}" ? "[0-9]{1,32}" : "[A-Z0-9]{1,32}";
  return new RegExp(`(?:^|[^A-Z0-9])(${escapeRegex(prefix)}${capture}${escapeRegex(suffix)})(?=$|[^A-Z0-9])`);
}

function customerKey(rule: DescriptionCustomerRule) {
  return rule.customerExternalId?.trim().toUpperCase()
    || `${rule.customerId}:${normalizeEntityName(rule.customerName)}`;
}

export function descriptionRuleTargetsInvoice(rule: DescriptionCustomerRule, invoice: Invoice) {
  if (rule.customerExternalId && invoice.customerId) {
    return rule.customerExternalId.trim().toUpperCase() === invoice.customerId.trim().toUpperCase();
  }
  return normalizeEntityName(rule.customerName) === normalizeEntityName(invoice.customerName);
}

export function referenceRuleForInvoice(
  evaluation: PaymentRuleEvaluation | undefined,
  invoice: Invoice,
): ReferenceTemplateRule | undefined {
  if (!evaluation) return undefined;
  const references = new Set(invoiceReferences(invoice));
  return evaluation.extractedReferences.find((item) => references.has(item.reference))?.rule;
}

export function descriptionRuleForInvoice(
  evaluation: PaymentRuleEvaluation | undefined,
  invoice: Invoice,
): DescriptionCustomerRule | undefined {
  if (!evaluation?.descriptionMappings.length) return undefined;
  const targets = new Set(evaluation.descriptionMappings.map(customerKey));
  if (targets.size !== 1) return undefined;
  return evaluation.descriptionMappings.find((rule) => descriptionRuleTargetsInvoice(rule, invoice));
}

export function acceptedFeeRule(
  evaluation: PaymentRuleEvaluation | undefined,
  invoiceBalanceMinor: number,
  shortageMinor: number,
  config: ReconciliationConfig,
): AcceptedFeeBehaviorRule | undefined {
  if (!evaluation || invoiceBalanceMinor <= 0 || shortageMinor <= 0) return undefined;
  const globalBasisPoints = Math.max(0, Math.floor(config.feeTolerancePercent * 10_000));
  return evaluation.feeBehaviors.find((rule) => {
    const maximumMinor = Math.min(config.maximumFeeMinor, rule.maximumFeeMinor);
    const maximumBasisPoints = Math.min(globalBasisPoints, rule.maximumFeeBasisPoints);
    return shortageMinor <= maximumMinor
      && shortageMinor * 10_000 <= invoiceBalanceMinor * maximumBasisPoints;
  });
}

export function evaluateCustomRules(
  payments: Payment[],
  rules: CustomMatchingRule[],
): PaymentRuleEvaluations {
  const descriptionRules = rules
    .filter((rule): rule is DescriptionCustomerRule => rule.kind === "description_customer")
    .map((rule) => ({ rule, pattern: canonicalDescriptionPattern(rule.normalizedPattern || rule.sourcePattern) }))
    .filter((entry): entry is { rule: DescriptionCustomerRule; pattern: string } => Boolean(entry.pattern));
  const referenceRules = rules
    .filter((rule): rule is ReferenceTemplateRule => rule.kind === "reference_template")
    .map((rule) => ({ rule, regex: referenceTemplateRegex(rule) }))
    .filter((entry): entry is { rule: ReferenceTemplateRule; regex: RegExp } => Boolean(entry.regex));
  const feeRules = rules
    .filter((rule): rule is AcceptedFeeBehaviorRule => rule.kind === "accepted_fee_behavior")
    .map((rule) => ({ rule, pattern: canonicalDescriptionPattern(rule.normalizedPattern || rule.sourcePattern) }))
    .filter((entry): entry is { rule: AcceptedFeeBehaviorRule; pattern: string } => Boolean(entry.pattern));
  const evaluations = new Map<Payment, PaymentRuleEvaluation>();

  for (const payment of payments) {
    const descriptionText = paymentDescriptionText(payment);
    const referenceText = paymentReferenceText(payment);
    const descriptionMappings = descriptionRules
      .filter((entry) => literalContains(descriptionText, entry.pattern))
      .map((entry) => entry.rule);
    const feeBehaviors = feeRules
      .filter((entry) => literalContains(descriptionText, entry.pattern))
      .map((entry) => entry.rule);
    const extractedReferences = referenceRules.flatMap(({ rule, regex }) => {
      const match = regex.exec(referenceText);
      const reference = normalizeReference(match?.[1]);
      return reference.length >= 4 ? [{ rule, reference }] : [];
    });
    evaluations.set(payment, { descriptionMappings, extractedReferences, feeBehaviors });
  }
  return evaluations;
}
