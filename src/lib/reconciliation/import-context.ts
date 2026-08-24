import { z } from "zod";
import type { Invoice, Payment } from "./types";

const invoiceStateSchema = z.object({
  client_id: z.string().trim().min(1).max(1000),
  outstanding_amount_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["open", "partially_paid", "paid", "void"]),
}).strict();

const paymentStateSchema = z.object({
  client_id: z.string().trim().min(1).max(1000),
  unapplied_amount_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum([
    "unmatched",
    "suggested",
    "review",
    "partially_applied",
    "reconciled",
    "ignored",
  ]),
}).strict();

const canonicalImportContextSchema = z.object({
  invoice_states: z.array(invoiceStateSchema).max(50_000),
  payment_states: z.array(paymentStateSchema).max(50_000),
}).strict().superRefine((value, context) => {
  const invoiceIds = new Set<string>();
  for (const [index, state] of value.invoice_states.entries()) {
    if (invoiceIds.has(state.client_id)) {
      context.addIssue({ code: "custom", path: ["invoice_states", index, "client_id"], message: "Canonical invoice state IDs must be unique." });
    }
    invoiceIds.add(state.client_id);
  }
  const paymentIds = new Set<string>();
  for (const [index, state] of value.payment_states.entries()) {
    if (paymentIds.has(state.client_id)) {
      context.addIssue({ code: "custom", path: ["payment_states", index, "client_id"], message: "Canonical payment state IDs must be unique." });
    }
    paymentIds.add(state.client_id);
  }
});

export type CanonicalImportContext = z.infer<typeof canonicalImportContextSchema>;

export function parseCanonicalImportContext(value: unknown): CanonicalImportContext | null {
  const parsed = canonicalImportContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function applyCanonicalImportContext(
  invoices: Invoice[],
  payments: Payment[],
  context: CanonicalImportContext,
) {
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const invoiceStateById = new Map(context.invoice_states.map((state) => [state.client_id, state]));
  const paymentStateById = new Map(context.payment_states.map((state) => [state.client_id, state]));

  if (invoiceStateById.size !== context.invoice_states.length
      || paymentStateById.size !== context.payment_states.length
      || context.invoice_states.some((state) => !invoiceById.has(state.client_id))
      || context.payment_states.some((state) => !paymentById.has(state.client_id))) return null;

  const carriedPaymentIds: string[] = [];
  const excludedPaymentIds: string[] = [];
  const canonicalPayments = payments.flatMap((payment) => {
    const canonical = paymentStateById.get(payment.id);
    if (!canonical) return [payment];
    if (canonical.unapplied_amount_minor === 0
        || canonical.status === "reconciled"
        || canonical.status === "ignored") {
      excludedPaymentIds.push(payment.id);
      return [];
    }
    carriedPaymentIds.push(payment.id);
    return [{ ...payment, amountMinor: canonical.unapplied_amount_minor }];
  });

  return {
    invoices: invoices.map((invoice) => {
      const canonical = invoiceStateById.get(invoice.id);
      return canonical ? {
        ...invoice,
        outstandingAmountMinor: canonical.outstanding_amount_minor,
        status: canonical.status,
      } : invoice;
    }),
    payments: canonicalPayments,
    existingInvoiceIds: context.invoice_states.map((state) => state.client_id),
    existingPaymentIds: context.payment_states.map((state) => state.client_id),
    carriedPaymentIds,
    excludedPaymentIds,
    newPaymentCount: payments.length - context.payment_states.length,
  };
}
