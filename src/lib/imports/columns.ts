import type {
  ColumnMapping,
  ColumnSuggestion,
  ImportField,
  ImportKind,
} from "./types";

const ALIASES: Record<ImportKind, Partial<Record<ImportField, string[]>>> = {
  invoice: {
    invoiceNumber: ["invoice number", "invoice no", "invoice #", "inv number", "inv no", "document number"],
    customerName: ["customer name", "customer", "client name", "client", "bill to", "company name"],
    customerId: ["customer id", "customer number", "client id", "account number"],
    customerEmail: ["customer email", "client email", "email"],
    invoiceDate: ["invoice date", "issued date", "issue date", "date"],
    dueDate: ["due date", "payment due", "pay by"],
    originalAmount: ["original amount", "invoice amount", "invoice total", "gross amount", "total"],
    outstandingBalance: ["outstanding balance", "open balance", "amount due", "balance due", "remaining balance"],
    currency: ["currency", "currency code", "ccy"],
    status: ["status", "invoice status"],
    reference: ["reference", "invoice reference", "ref"],
    purchaseOrder: ["po", "po number", "purchase order", "purchase order number"],
    memo: ["memo", "notes", "description"],
    accountId: ["account id", "ledger account"],
  },
  payment: {
    paymentDate: ["payment date", "transaction date", "posted date", "deposit date", "date"],
    amount: ["payment amount", "deposit amount", "transaction amount", "credit amount", "amount"],
    currency: ["currency", "currency code", "ccy"],
    payerName: ["payer name", "payer", "sender", "originator", "customer", "customer name"],
    payerId: ["payer id", "sender id", "customer id"],
    description: ["description", "bank description", "details", "narrative"],
    bankReference: ["bank reference", "bank ref", "reference", "reference number"],
    achId: ["ach id", "ach trace", "ach trace number"],
    wireId: ["wire id", "wire reference"],
    memo: ["memo", "payment memo", "note"],
    transactionId: ["transaction id", "transaction number", "txn id", "payment id"],
    accountId: ["account", "account id", "bank account"],
  },
};

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9# ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestColumns(headers: string[], kind: ImportKind): ColumnSuggestion[] {
  const usedHeaders = new Set<string>();
  const suggestions: ColumnSuggestion[] = [];
  for (const [field, aliases] of Object.entries(ALIASES[kind]) as [ImportField, string[]][]) {
    const exact = headers.find((header) => !usedHeaders.has(header) && aliases.includes(normalizeHeader(header)));
    if (exact) {
      usedHeaders.add(exact);
      suggestions.push({ field, header: exact, confidence: "exact" });
      continue;
    }
    const likely = headers.find((header) => {
      if (usedHeaders.has(header)) return false;
      const normalized = normalizeHeader(header);
      return aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized));
    });
    if (likely) {
      usedHeaders.add(likely);
      suggestions.push({ field, header: likely, confidence: "likely" });
    }
  }
  return suggestions;
}

export function mappingFromSuggestions(suggestions: ColumnSuggestion[]): ColumnMapping {
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.field, suggestion.header])) as ColumnMapping;
}
