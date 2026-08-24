import type {
  Invoice,
  PayerMappingRule,
  Payment,
  ReconciliationConfig,
} from "./types";
import {
  invoiceReferences,
  normalizeEntityName,
  paymentSearchText,
} from "./normalize";
import type { PaymentRuleEvaluations } from "./custom-rules";

const REFERENCE_KEY_MAX_LENGTH = 8;
const REFERENCE_KEY_MIN_LENGTH = 4;

interface InvoiceMetadata {
  currency: string;
  customerId?: string;
  customerIdCanonical?: string;
  day?: number;
  name: string;
  nameKeys: string[];
  referenceEntries: ReferenceEntry[];
}

interface PaymentMetadata {
  currency: string;
  day?: number;
  name: string;
  nameKeys: string[];
  payerId?: string;
}

interface ReferenceEntry {
  invoice: Invoice;
  reference: string;
}

export interface CandidateQuery<T> {
  exceeded: boolean;
  items: T[];
  minimumCandidateCount: number;
}

export type PayerMappingIndex = Map<string, PayerMappingRule[]>;

function normalizedCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function canonicalId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function calendarDay(value: string): number | undefined {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.round(parsed / 86_400_000) : undefined;
}

function amountDayKey(currency: string, amountMinor: number, day: number): string {
  return `${currency}\u001f${amountMinor}\u001f${day}`;
}

function dayKey(currency: string, day: number): string {
  return `${currency}\u001f${day}`;
}

function addToBucket<T>(buckets: Map<string, Set<T>>, key: string | undefined, value: T): void {
  if (key === undefined) return;
  const bucket = buckets.get(key) ?? new Set<T>();
  bucket.add(value);
  buckets.set(key, bucket);
}

function removeFromBucket<T>(buckets: Map<string, Set<T>>, key: string | undefined, value: T): void {
  if (key === undefined) return;
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket.delete(value);
  if (bucket.size === 0) buckets.delete(key);
}

function nameLookupKeys(normalizedName: string): string[] {
  const compact = normalizedName.replace(/\s/g, "");
  if (!compact) return [];
  if (compact.length === 1) return [compact];
  const keys = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    keys.add(compact.slice(index, index + 2));
  }
  return [...keys];
}

function referenceIndexKey(reference: string): string {
  return reference.slice(0, REFERENCE_KEY_MAX_LENGTH);
}

function paymentReferenceLookupKeys(searchText: string): string[] {
  const keys = new Set<string>();
  const maximumLength = Math.min(REFERENCE_KEY_MAX_LENGTH, searchText.length);
  for (let length = REFERENCE_KEY_MIN_LENGTH; length <= maximumLength; length += 1) {
    for (let index = 0; index <= searchText.length - length; index += 1) {
      keys.add(searchText.slice(index, index + length));
    }
  }
  return [...keys];
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function safeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function queryResult<T extends { id: string }>(selected: Set<T>, exceeded: boolean, limit: number): CandidateQuery<T> {
  const items = [...selected]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, limit);
  return {
    exceeded,
    items,
    minimumCandidateCount: exceeded ? Math.max(limit + 1, selected.size) : selected.size,
  };
}

export function buildPayerMappingIndex(rules: PayerMappingRule[]): PayerMappingIndex {
  const result: PayerMappingIndex = new Map();
  const orderedRules = [...rules].sort((left, right) =>
    left.normalizedAlias.localeCompare(right.normalizedAlias)
    || left.customerId.localeCompare(right.customerId)
    || left.id.localeCompare(right.id));
  for (const rule of orderedRules) {
    const alias = normalizeEntityName(rule.alias) || normalizeEntityName(rule.normalizedAlias);
    if (!alias) continue;
    const existing = result.get(alias) ?? [];
    existing.push(rule);
    result.set(alias, existing);
  }
  return result;
}

export function payerMappingTargetsInvoice(rule: PayerMappingRule, invoice: Invoice): boolean {
  if (rule.customerExternalId && invoice.customerId) {
    return canonicalId(rule.customerExternalId) === canonicalId(invoice.customerId);
  }
  return normalizeEntityName(rule.customerName) === normalizeEntityName(invoice.customerName);
}

export function payerMappingFor(
  payment: Payment,
  invoice: Invoice,
  mappings: PayerMappingIndex,
): PayerMappingRule | undefined {
  const normalizedPayer = normalizeEntityName(payment.payerName);
  if (!normalizedPayer) return undefined;
  return mappings.get(normalizedPayer)?.find((rule) => payerMappingTargetsInvoice(rule, invoice));
}

export class ReconciliationCandidateIndex {
  private readonly activeInvoices = new Set<Invoice>();
  private readonly activePayments = new Set<Payment>();
  private readonly amountDayBuckets = new Map<string, Set<Invoice>>();
  private readonly dayBuckets = new Map<string, Set<Invoice>>();
  private readonly daysByCurrency = new Map<string, number[]>();
  private readonly invoiceByCustomerId = new Map<string, Set<Invoice>>();
  private readonly invoiceByCustomerIdCanonical = new Map<string, Set<Invoice>>();
  private readonly invoiceByName = new Map<string, Set<Invoice>>();
  private readonly invoiceByNameKey = new Map<string, Set<Invoice>>();
  private readonly invoiceMetadata = new Map<Invoice, InvoiceMetadata>();
  private readonly paymentByName = new Map<string, Set<Payment>>();
  private readonly paymentByNameKey = new Map<string, Set<Payment>>();
  private readonly paymentByPayerId = new Map<string, Set<Payment>>();
  private readonly paymentMetadata = new Map<Payment, PaymentMetadata>();
  private readonly referenceEntries = new Map<string, Set<ReferenceEntry>>();
  private readonly referenceInvoicesByPayment = new Map<Payment, CandidateQuery<Invoice>>();
  private readonly referencePaymentsByInvoice = new Map<Invoice, Set<Payment>>();
  private readonly rulesByCustomerExternalId = new Map<string, PayerMappingRule[]>();
  private readonly rulesByCustomerName = new Map<string, PayerMappingRule[]>();
  private readonly rulesWithoutExternalIdByCustomerName = new Map<string, PayerMappingRule[]>();
  private readonly customPaymentsByCustomerExternalId = new Map<string, Set<Payment>>();
  private readonly customPaymentsByCustomerName = new Map<string, Set<Payment>>();

  constructor(
    invoices: Invoice[],
    payments: Payment[],
    private readonly remaining: Map<string, number>,
    private readonly mappings: PayerMappingIndex,
    private readonly customEvaluations: PaymentRuleEvaluations = new Map(),
  ) {
    const days = new Map<string, Set<number>>();
    for (const invoice of [...invoices].sort((left, right) => left.id.localeCompare(right.id))) {
      const metadata = this.createInvoiceMetadata(invoice);
      this.invoiceMetadata.set(invoice, metadata);
      this.activeInvoices.add(invoice);
      this.addInvoiceToIdentityIndexes(invoice, metadata);
      this.addInvoiceBalance(invoice, invoice.outstandingAmountMinor, metadata);
      if (metadata.day !== undefined) {
        const currencyDays = days.get(metadata.currency) ?? new Set<number>();
        currencyDays.add(metadata.day);
        days.set(metadata.currency, currencyDays);
      }
    }
    for (const [currency, currencyDays] of days) {
      this.daysByCurrency.set(currency, [...currencyDays].sort((left, right) => left - right));
    }

    for (const payment of [...payments].sort((left, right) => left.id.localeCompare(right.id))) {
      const metadata = this.createPaymentMetadata(payment);
      this.paymentMetadata.set(payment, metadata);
      this.activePayments.add(payment);
      addToBucket(this.paymentByName, metadata.name, payment);
      metadata.nameKeys.forEach((key) => addToBucket(this.paymentByNameKey, key, payment));
      addToBucket(this.paymentByPayerId, metadata.payerId, payment);
      const descriptionMappings = this.customEvaluations.get(payment)?.descriptionMappings ?? [];
      const targets = new Set(descriptionMappings.map((rule) =>
        canonicalId(rule.customerExternalId) || `NAME:${normalizeEntityName(rule.customerName)}`));
      if (targets.size === 1) {
        for (const rule of descriptionMappings) {
          addToBucket(this.customPaymentsByCustomerExternalId, canonicalId(rule.customerExternalId), payment);
          addToBucket(this.customPaymentsByCustomerName, normalizeEntityName(rule.customerName), payment);
        }
      }
    }

    for (const rules of mappings.values()) {
      for (const rule of rules) {
        const customerName = normalizeEntityName(rule.customerName);
        const externalId = canonicalId(rule.customerExternalId);
        if (customerName) {
          const namedRules = this.rulesByCustomerName.get(customerName) ?? [];
          namedRules.push(rule);
          this.rulesByCustomerName.set(customerName, namedRules);
          if (!externalId) {
            const rulesWithoutExternalId = this.rulesWithoutExternalIdByCustomerName.get(customerName) ?? [];
            rulesWithoutExternalId.push(rule);
            this.rulesWithoutExternalIdByCustomerName.set(customerName, rulesWithoutExternalId);
          }
        }
        if (externalId) {
          const externalRules = this.rulesByCustomerExternalId.get(externalId) ?? [];
          externalRules.push(rule);
          this.rulesByCustomerExternalId.set(externalId, externalRules);
        }
      }
    }
  }

  exactBalanceInvoices(
    payment: Payment,
    config: ReconciliationConfig,
    candidateLimit: number,
  ): CandidateQuery<Invoice> {
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Invoice>();
    const metadata = this.paymentMetadata.get(payment);
    if (!metadata) return queryResult(selected, false, limit);
    let exceeded = false;
    this.forEligibleInvoiceDays(metadata.currency, metadata.day, config, (day) => {
      exceeded = this.collect(
        this.amountDayBuckets.get(amountDayKey(metadata.currency, payment.amountMinor, day)),
        selected,
        limit,
      ) || exceeded;
      return exceeded;
    });
    const references = this.referenceInvoices(payment, limit);
    for (const invoice of references.items) {
      if (
        this.isInvoiceActive(invoice)
        && normalizedCurrency(invoice.currency) === metadata.currency
        && (this.remaining.get(invoice.id) ?? 0) === payment.amountMinor
      ) {
        selected.add(invoice);
        if (selected.size > limit) exceeded = true;
      }
    }
    return queryResult(selected, exceeded || references.exceeded, limit);
  }

  identityInvoices(
    payment: Payment,
    config: ReconciliationConfig,
    candidateLimit: number,
  ): CandidateQuery<Invoice> {
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Invoice>();
    const metadata = this.paymentMetadata.get(payment);
    if (!metadata) return queryResult(selected, false, limit);
    const references = this.referenceInvoices(payment, limit);
    const referenceSet = new Set(references.items);
    let exceeded = references.exceeded;
    const eligible = (invoice: Invoice) =>
      normalizedCurrency(invoice.currency) === metadata.currency
      && (referenceSet.has(invoice) || this.dateEligible(metadata.day, this.invoiceMetadata.get(invoice)?.day, config));
    const add = (bucket: Set<Invoice> | undefined) => {
      if (exceeded) return;
      exceeded = this.collect(bucket, selected, limit, eligible) || exceeded;
    };
    references.items.forEach((invoice) => {
      if (eligible(invoice)) selected.add(invoice);
    });
    add(metadata.payerId ? this.invoiceByCustomerId.get(metadata.payerId) : undefined);
    if (metadata.name) add(this.invoiceByName.get(metadata.name));
    metadata.nameKeys.forEach((key) => add(this.invoiceByNameKey.get(key)));
    for (const rule of this.mappings.get(metadata.name) ?? []) {
      add(rule.customerExternalId
        ? this.invoiceByCustomerIdCanonical.get(canonicalId(rule.customerExternalId) ?? "")
        : this.invoiceByName.get(normalizeEntityName(rule.customerName)));
      add(this.invoiceByName.get(normalizeEntityName(rule.customerName)));
    }
    const descriptionMappings = this.customEvaluations.get(payment)?.descriptionMappings ?? [];
    const targets = new Set(descriptionMappings.map((rule) =>
      canonicalId(rule.customerExternalId) || `NAME:${normalizeEntityName(rule.customerName)}`));
    if (targets.size === 1) {
      for (const rule of descriptionMappings) {
        add(rule.customerExternalId
          ? this.invoiceByCustomerIdCanonical.get(canonicalId(rule.customerExternalId) ?? "")
          : this.invoiceByName.get(normalizeEntityName(rule.customerName)));
        add(this.invoiceByName.get(normalizeEntityName(rule.customerName)));
      }
    }
    return queryResult(selected, exceeded, limit);
  }

  allEligibleInvoices(
    payment: Payment,
    config: ReconciliationConfig,
    candidateLimit: number,
  ): CandidateQuery<Invoice> {
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Invoice>();
    const metadata = this.paymentMetadata.get(payment);
    if (!metadata) return queryResult(selected, false, limit);
    let exceeded = false;
    this.forEligibleInvoiceDays(metadata.currency, metadata.day, config, (day) => {
      exceeded = this.collect(this.dayBuckets.get(dayKey(metadata.currency, day)), selected, limit) || exceeded;
      return exceeded;
    });
    const references = this.referenceInvoices(payment, limit);
    for (const invoice of references.items) {
      if (this.isInvoiceActive(invoice) && normalizedCurrency(invoice.currency) === metadata.currency) {
        selected.add(invoice);
        if (selected.size > limit) exceeded = true;
      }
    }
    return queryResult(selected, exceeded || references.exceeded, limit);
  }

  crossCurrencyIdentityInvoices(payment: Payment, candidateLimit: number): CandidateQuery<Invoice> {
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Invoice>();
    const metadata = this.paymentMetadata.get(payment);
    if (!metadata) return queryResult(selected, false, limit);
    const references = this.referenceInvoices(payment, limit);
    const crossCurrency = (invoice: Invoice) => normalizedCurrency(invoice.currency) !== metadata.currency;
    let exceeded = references.exceeded;
    const add = (bucket: Set<Invoice> | undefined) => {
      if (exceeded) return;
      exceeded = this.collect(bucket, selected, limit, crossCurrency) || exceeded;
    };
    references.items.forEach((invoice) => {
      if (crossCurrency(invoice)) selected.add(invoice);
    });
    if (metadata.name) add(this.invoiceByName.get(metadata.name));
    metadata.nameKeys.forEach((key) => add(this.invoiceByNameKey.get(key)));
    for (const rule of this.mappings.get(metadata.name) ?? []) {
      add(rule.customerExternalId
        ? this.invoiceByCustomerIdCanonical.get(canonicalId(rule.customerExternalId) ?? "")
        : this.invoiceByName.get(normalizeEntityName(rule.customerName)));
      add(this.invoiceByName.get(normalizeEntityName(rule.customerName)));
    }
    const descriptionMappings = this.customEvaluations.get(payment)?.descriptionMappings ?? [];
    const targets = new Set(descriptionMappings.map((rule) =>
      canonicalId(rule.customerExternalId) || `NAME:${normalizeEntityName(rule.customerName)}`));
    if (targets.size === 1) {
      for (const rule of descriptionMappings) {
        add(rule.customerExternalId
          ? this.invoiceByCustomerIdCanonical.get(canonicalId(rule.customerExternalId) ?? "")
          : this.invoiceByName.get(normalizeEntityName(rule.customerName)));
        add(this.invoiceByName.get(normalizeEntityName(rule.customerName)));
      }
    }
    return queryResult(selected, exceeded, limit);
  }

  identityPayments(
    invoice: Invoice,
    config: ReconciliationConfig,
    candidateLimit: number,
    excludedPaymentIds: Set<string>,
  ): CandidateQuery<Payment> {
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Payment>();
    const metadata = this.invoiceMetadata.get(invoice);
    if (!metadata) return queryResult(selected, false, limit);
    const referencedPayments = this.referencePaymentsByInvoice.get(invoice) ?? new Set<Payment>();
    const eligible = (payment: Payment) => {
      const paymentMetadata = this.paymentMetadata.get(payment);
      return Boolean(
        paymentMetadata
        && !excludedPaymentIds.has(payment.id)
        && payment.amountMinor < (this.remaining.get(invoice.id) ?? 0)
        && paymentMetadata.currency === metadata.currency
        && (referencedPayments.has(payment) || this.dateEligible(paymentMetadata.day, metadata.day, config)),
      );
    };
    let exceeded = false;
    const add = (bucket: Set<Payment> | undefined) => {
      if (exceeded) return;
      exceeded = this.collect(bucket, selected, limit, eligible) || exceeded;
    };
    add(referencedPayments);
    add(metadata.customerId ? this.paymentByPayerId.get(metadata.customerId) : undefined);
    if (metadata.name) add(this.paymentByName.get(metadata.name));
    metadata.nameKeys.forEach((key) => add(this.paymentByNameKey.get(key)));

    const mappingRules = metadata.customerIdCanonical
      ? [
          ...(this.rulesByCustomerExternalId.get(metadata.customerIdCanonical) ?? []),
          ...(this.rulesWithoutExternalIdByCustomerName.get(metadata.name) ?? []),
        ]
      : (this.rulesByCustomerName.get(metadata.name) ?? []);
    for (const rule of mappingRules) {
      const alias = normalizeEntityName(rule.alias) || normalizeEntityName(rule.normalizedAlias);
      add(this.paymentByName.get(alias));
    }
    add(metadata.customerIdCanonical
      ? this.customPaymentsByCustomerExternalId.get(metadata.customerIdCanonical)
      : undefined);
    add(this.customPaymentsByCustomerName.get(metadata.name));
    return queryResult(selected, exceeded, limit);
  }

  updateInvoiceBalance(invoice: Invoice, nextBalance: number): void {
    const metadata = this.invoiceMetadata.get(invoice);
    if (!metadata) return;
    const previousBalance = this.remaining.get(invoice.id) ?? invoice.outstandingAmountMinor;
    this.removeInvoiceBalance(invoice, previousBalance, metadata);
    this.remaining.set(invoice.id, Math.max(0, nextBalance));
    if (nextBalance > 0) {
      this.addInvoiceBalance(invoice, nextBalance, metadata);
      return;
    }
    this.activeInvoices.delete(invoice);
    this.removeInvoiceFromIdentityIndexes(invoice, metadata);
  }

  deactivatePayment(payment: Payment): void {
    if (!this.activePayments.delete(payment)) return;
    const metadata = this.paymentMetadata.get(payment);
    if (!metadata) return;
    removeFromBucket(this.paymentByName, metadata.name, payment);
    metadata.nameKeys.forEach((key) => removeFromBucket(this.paymentByNameKey, key, payment));
    removeFromBucket(this.paymentByPayerId, metadata.payerId, payment);
    for (const invoice of this.referenceInvoicesByPayment.get(payment)?.items ?? []) {
      this.referencePaymentsByInvoice.get(invoice)?.delete(payment);
    }
  }

  private addInvoiceBalance(invoice: Invoice, balance: number, metadata: InvoiceMetadata): void {
    if (metadata.day !== undefined) {
      addToBucket(this.amountDayBuckets, amountDayKey(metadata.currency, balance, metadata.day), invoice);
      addToBucket(this.dayBuckets, dayKey(metadata.currency, metadata.day), invoice);
    }
  }

  private addInvoiceToIdentityIndexes(invoice: Invoice, metadata: InvoiceMetadata): void {
    addToBucket(this.invoiceByCustomerId, metadata.customerId, invoice);
    addToBucket(this.invoiceByCustomerIdCanonical, metadata.customerIdCanonical, invoice);
    addToBucket(this.invoiceByName, metadata.name, invoice);
    metadata.nameKeys.forEach((key) => addToBucket(this.invoiceByNameKey, key, invoice));
    for (const entry of metadata.referenceEntries) addToBucket(this.referenceEntries, referenceIndexKey(entry.reference), entry);
  }

  private collect<T extends { id: string }>(
    bucket: Set<T> | undefined,
    selected: Set<T>,
    limit: number,
    predicate: (value: T) => boolean = () => true,
  ): boolean {
    if (!bucket) return false;
    for (const value of bucket) {
      if (!predicate(value)) continue;
      selected.add(value);
      if (selected.size > limit) return true;
    }
    return false;
  }

  private createInvoiceMetadata(invoice: Invoice): InvoiceMetadata {
    const name = normalizeEntityName(invoice.customerName);
    return {
      currency: normalizedCurrency(invoice.currency),
      customerId: invoice.customerId,
      customerIdCanonical: canonicalId(invoice.customerId),
      day: calendarDay(invoice.invoiceDate),
      name,
      nameKeys: nameLookupKeys(name),
      referenceEntries: invoiceReferences(invoice).map((reference) => ({ invoice, reference })),
    };
  }

  private createPaymentMetadata(payment: Payment): PaymentMetadata {
    const name = normalizeEntityName(payment.payerName);
    return {
      currency: normalizedCurrency(payment.currency),
      day: calendarDay(payment.paymentDate),
      name,
      nameKeys: nameLookupKeys(name),
      payerId: payment.payerId,
    };
  }

  private dateEligible(paymentDay: number | undefined, invoiceDay: number | undefined, config: ReconciliationConfig): boolean {
    if (paymentDay === undefined || invoiceDay === undefined) return false;
    const difference = paymentDay - invoiceDay;
    return difference >= -config.earlyPaymentAllowanceDays && difference <= config.dateWindowDays;
  }

  private forEligibleInvoiceDays(
    currency: string,
    paymentDay: number | undefined,
    config: ReconciliationConfig,
    visit: (day: number) => boolean,
  ): void {
    if (paymentDay === undefined) return;
    const days = this.daysByCurrency.get(currency) ?? [];
    const first = lowerBound(days, paymentDay - config.dateWindowDays);
    const last = upperBound(days, paymentDay + config.earlyPaymentAllowanceDays);
    for (let index = first; index < last; index += 1) {
      if (visit(days[index])) return;
    }
  }

  private isInvoiceActive(invoice: Invoice): boolean {
    return this.activeInvoices.has(invoice) && (this.remaining.get(invoice.id) ?? 0) > 0;
  }

  private referenceInvoices(payment: Payment, candidateLimit: number): CandidateQuery<Invoice> {
    const cached = this.referenceInvoicesByPayment.get(payment);
    if (cached) {
      const active = new Set(cached.items.filter((invoice) => this.isInvoiceActive(invoice)));
      return queryResult(active, cached.exceeded, safeLimit(candidateLimit));
    }
    const limit = safeLimit(candidateLimit);
    const selected = new Set<Invoice>();
    const searchText = paymentSearchText(payment);
    let exceeded = false;
    lookup: for (const key of paymentReferenceLookupKeys(searchText)) {
      for (const entry of this.referenceEntries.get(key) ?? []) {
        if (!this.isInvoiceActive(entry.invoice) || !searchText.includes(entry.reference)) continue;
        selected.add(entry.invoice);
        if (selected.size > limit) {
          exceeded = true;
          break lookup;
        }
      }
    }
    for (const extracted of this.customEvaluations.get(payment)?.extractedReferences ?? []) {
      for (const entry of this.referenceEntries.get(referenceIndexKey(extracted.reference)) ?? []) {
        if (!this.isInvoiceActive(entry.invoice) || entry.reference !== extracted.reference) continue;
        selected.add(entry.invoice);
        if (selected.size > limit) {
          exceeded = true;
          break;
        }
      }
      if (exceeded) break;
    }
    const result = queryResult(selected, exceeded, limit);
    this.referenceInvoicesByPayment.set(payment, result);
    for (const invoice of result.items) {
      const payments = this.referencePaymentsByInvoice.get(invoice) ?? new Set<Payment>();
      payments.add(payment);
      this.referencePaymentsByInvoice.set(invoice, payments);
    }
    return result;
  }

  private removeInvoiceBalance(invoice: Invoice, balance: number, metadata: InvoiceMetadata): void {
    if (metadata.day !== undefined) {
      removeFromBucket(this.amountDayBuckets, amountDayKey(metadata.currency, balance, metadata.day), invoice);
      removeFromBucket(this.dayBuckets, dayKey(metadata.currency, metadata.day), invoice);
    }
  }

  private removeInvoiceFromIdentityIndexes(invoice: Invoice, metadata: InvoiceMetadata): void {
    removeFromBucket(this.invoiceByCustomerId, metadata.customerId, invoice);
    removeFromBucket(this.invoiceByCustomerIdCanonical, metadata.customerIdCanonical, invoice);
    removeFromBucket(this.invoiceByName, metadata.name, invoice);
    metadata.nameKeys.forEach((key) => removeFromBucket(this.invoiceByNameKey, key, invoice));
    for (const entry of metadata.referenceEntries) removeFromBucket(this.referenceEntries, referenceIndexKey(entry.reference), entry);
  }
}
