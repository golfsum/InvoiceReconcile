import type { Invoice, Payment } from "./types";
import { normalizeEntityName, normalizeReference } from "./normalize";

export function canonicalInvoiceIdentity(invoice: Pick<Invoice, "invoiceNumber" | "customerName" | "currency" | "originalAmountMinor" | "accountId">) {
  return [
    "invoice",
    normalizeReference(invoice.invoiceNumber),
    normalizeEntityName(invoice.customerName),
    invoice.currency.toUpperCase(),
    invoice.originalAmountMinor,
    normalizeReference(invoice.accountId),
  ].join(":");
}

export function canonicalPaymentIdentity(payment: Pick<Payment, "transactionId" | "paymentDate" | "amountMinor" | "currency" | "bankReference" | "achId" | "wireId" | "description" | "payerName" | "accountId">) {
  const transaction = normalizeReference(payment.transactionId);
  const account = normalizeReference(payment.accountId);
  if (transaction) return `payment:transaction:${account}:${transaction}`;
  const fallbackReference = normalizeReference(
    payment.bankReference || payment.achId || payment.wireId || payment.description,
  );
  return [
    "payment",
    "fingerprint",
    payment.paymentDate,
    payment.amountMinor,
    payment.currency.toUpperCase(),
    account,
    fallbackReference,
    normalizeEntityName(payment.payerName),
  ].join(":");
}
