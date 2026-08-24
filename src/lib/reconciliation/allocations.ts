import type { Invoice, ProposedMatch } from "./types";

export type InvoiceAllocation = {
  invoiceId: string;
  amountMinor: number;
};

export type AllocationValidationResult =
  | { ok: true; totalMinor: number; remainingPaymentMinor: number }
  | { ok: false; error: string };

export function minorToAmountInput(amountMinor: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "";
  const whole = Math.floor(amountMinor / 100);
  const fraction = String(amountMinor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function amountInputToMinor(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  try {
    const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0");
    return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
  } catch {
    return null;
  }
}

export function defaultInvoiceAllocations(
  match: Pick<ProposedMatch, "invoiceIds" | "appliedAmountMinor" | "paymentAmountMinor">,
  invoices: Map<string, Pick<Invoice, "id" | "outstandingAmountMinor">>,
) {
  let remaining = Math.min(
    match.paymentAmountMinor,
    match.appliedAmountMinor > 0 ? match.appliedAmountMinor : match.paymentAmountMinor,
  );
  const allocations: InvoiceAllocation[] = [];
  for (const invoiceId of match.invoiceIds) {
    const invoice = invoices.get(invoiceId);
    if (!invoice || remaining <= 0) continue;
    const amountMinor = Math.min(invoice.outstandingAmountMinor, remaining);
    if (amountMinor <= 0) continue;
    allocations.push({ invoiceId, amountMinor });
    remaining -= amountMinor;
  }
  return allocations;
}

export function validateInvoiceAllocations(input: {
  allocations: InvoiceAllocation[];
  appliedAmountMinor: number;
  paymentAvailableMinor: number;
  paymentCurrency: string;
  invoices: Map<string, Pick<Invoice, "id" | "currency" | "outstandingAmountMinor">>;
}): AllocationValidationResult {
  if (input.allocations.length === 0) return { ok: false, error: "Choose at least one invoice allocation." };
  if (input.allocations.length > 100) return { ok: false, error: "A decision can allocate to at most 100 invoices." };
  if (!Number.isSafeInteger(input.appliedAmountMinor) || input.appliedAmountMinor <= 0) {
    return { ok: false, error: "The total applied amount must be a positive whole number of minor currency units." };
  }
  if (!Number.isSafeInteger(input.paymentAvailableMinor) || input.paymentAvailableMinor < 0) {
    return { ok: false, error: "The available payment amount is invalid." };
  }

  const seen = new Set<string>();
  let totalMinor = 0;
  for (const allocation of input.allocations) {
    if (!allocation.invoiceId || seen.has(allocation.invoiceId)) {
      return { ok: false, error: seen.has(allocation.invoiceId) ? "Each invoice can appear only once." : "Every allocation must identify an invoice." };
    }
    seen.add(allocation.invoiceId);
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor <= 0) {
      return { ok: false, error: "Every invoice allocation must be greater than zero." };
    }
    const invoice = input.invoices.get(allocation.invoiceId);
    if (!invoice) return { ok: false, error: "A selected invoice is no longer available." };
    if (invoice.currency !== input.paymentCurrency) {
      return { ok: false, error: "Every selected invoice must use the payment currency." };
    }
    if (allocation.amountMinor > invoice.outstandingAmountMinor) {
      return { ok: false, error: "The allocation for this invoice exceeds its outstanding balance." };
    }
    if (totalMinor > Number.MAX_SAFE_INTEGER - allocation.amountMinor) {
      return { ok: false, error: "The allocation total is too large." };
    }
    totalMinor += allocation.amountMinor;
  }

  if (totalMinor !== input.appliedAmountMinor) {
    return { ok: false, error: "The applied total must equal the sum of the invoice allocations." };
  }
  if (totalMinor > input.paymentAvailableMinor) {
    return { ok: false, error: "The invoice allocations exceed the available payment amount." };
  }
  return {
    ok: true,
    totalMinor,
    remainingPaymentMinor: input.paymentAvailableMinor - totalMinor,
  };
}
