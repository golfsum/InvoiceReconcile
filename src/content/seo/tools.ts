export type AmountRow = { id: string; label: string; cents: number };

export function parseCurrencyToCents(value: string): number | null {
  const cleaned = value.trim().replace(/[$,\s]/g, "");
  if (!cleaned || !/^(?:\d+|\d*\.\d{1,2})$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function parseAmountRows(input: string, prefix = "Item"): { rows: AmountRow[]; errors: string[] } {
  const rows: AmountRow[] = [];
  const errors: string[] = [];
  input.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[\t,]/).map((part) => part.trim()).filter(Boolean);
    const amountText = parts.length > 1 ? parts.at(-1)! : parts[0];
    const cents = parseCurrencyToCents(amountText);
    if (cents === null || cents === 0) {
      errors.push(`Line ${index + 1} needs a positive amount.`);
      return;
    }
    const label = parts.length > 1 ? parts.slice(0, -1).join(" ") : `${prefix} ${rows.length + 1}`;
    rows.push({ id: `${index}-${label}-${cents}`, label, cents });
  });
  return { rows, errors };
}

export function findLumpSumCombinations(
  paymentCents: number,
  invoices: AmountRow[],
  options: { maxCandidates?: number; maxCombinationSize?: number; maxResults?: number } = {},
): AmountRow[][] {
  const maxCandidates = options.maxCandidates ?? 20;
  const maxCombinationSize = options.maxCombinationSize ?? 8;
  const maxResults = options.maxResults ?? 12;
  if (paymentCents <= 0 || invoices.length === 0 || invoices.length > maxCandidates) return [];
  const candidates = invoices.filter((invoice) => invoice.cents <= paymentCents).sort((a, b) => b.cents - a.cents);
  const results: AmountRow[][] = [];

  function search(index: number, remaining: number, selected: AmountRow[]) {
    if (results.length >= maxResults) return;
    if (remaining === 0) {
      results.push([...selected]);
      return;
    }
    if (remaining < 0 || index >= candidates.length || selected.length >= maxCombinationSize) return;
    for (let cursor = index; cursor < candidates.length; cursor += 1) {
      const candidate = candidates[cursor];
      if (candidate.cents > remaining) continue;
      selected.push(candidate);
      search(cursor + 1, remaining - candidate.cents, selected);
      selected.pop();
      if (results.length >= maxResults) return;
    }
  }

  search(0, paymentCents, []);
  return results;
}

export type ObviousMatch = {
  payment: AmountRow;
  invoice: AmountRow;
  status: "exact";
};

export function findUniqueExactMatches(invoices: AmountRow[], payments: AmountRow[]): { matches: ObviousMatch[]; ambiguousPayments: AmountRow[]; unmatchedPayments: AmountRow[] } {
  const invoicesByAmount = new Map<number, AmountRow[]>();
  for (const invoice of invoices) invoicesByAmount.set(invoice.cents, [...(invoicesByAmount.get(invoice.cents) ?? []), invoice]);
  const paymentsByAmount = new Map<number, AmountRow[]>();
  for (const payment of payments) paymentsByAmount.set(payment.cents, [...(paymentsByAmount.get(payment.cents) ?? []), payment]);
  const matches: ObviousMatch[] = [];
  const ambiguousPayments: AmountRow[] = [];
  const unmatchedPayments: AmountRow[] = [];
  for (const payment of payments) {
    const invoiceCandidates = invoicesByAmount.get(payment.cents) ?? [];
    const sameAmountPayments = paymentsByAmount.get(payment.cents) ?? [];
    if (invoiceCandidates.length === 1 && sameAmountPayments.length === 1) matches.push({ payment, invoice: invoiceCandidates[0], status: "exact" });
    else if (invoiceCandidates.length > 0) ambiguousPayments.push(payment);
    else unmatchedPayments.push(payment);
  }
  return { matches, ambiguousPayments, unmatchedPayments };
}

export type AllocationLine = AmountRow & { appliedCents: number; remainingCents: number };

export function allocatePayment(paymentCents: number, invoices: AmountRow[]): { lines: AllocationLine[]; unappliedCents: number } {
  let available = Math.max(0, paymentCents);
  const lines = invoices.map((invoice) => {
    const appliedCents = Math.min(invoice.cents, available);
    available -= appliedCents;
    return { ...invoice, appliedCents, remainingCents: invoice.cents - appliedCents };
  });
  return { lines, unappliedCents: available };
}

export type TimeEstimate = { monthlyHours: number; monthlyLaborCost: number; annualLaborCost: number };

export function calculateManualReconciliationTime(paymentsPerMonth: number, minutesPerPayment: number, hourlyCost: number): TimeEstimate {
  const monthlyHours = Math.max(0, paymentsPerMonth) * Math.max(0, minutesPerPayment) / 60;
  const monthlyLaborCost = monthlyHours * Math.max(0, hourlyCost);
  return { monthlyHours, monthlyLaborCost, annualLaborCost: monthlyLaborCost * 12 };
}

export function cleanInvoiceReference(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toUpperCase();
  if (!normalized) return "";
  const withoutLabel = normalized.replace(/^(?:INVOICE|INVC|INV)[\s._-]*(?:(?:NUMBER|NO\.?|#)\s*)?[:#-]?\s*/i, "");
  const body = withoutLabel.replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  if (!body) return "";
  return /^\d/.test(body) ? `INV-${body}` : body;
}
