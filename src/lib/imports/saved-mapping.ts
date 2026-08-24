import type { ColumnMapping, ImportField, ImportKind } from "./types";

const FIELDS_BY_KIND: Record<ImportKind, ReadonlySet<ImportField>> = {
  invoice: new Set<ImportField>([
    "invoiceNumber",
    "customerName",
    "customerId",
    "customerEmail",
    "invoiceDate",
    "dueDate",
    "originalAmount",
    "outstandingBalance",
    "currency",
    "status",
    "reference",
    "purchaseOrder",
    "memo",
    "accountId",
  ]),
  payment: new Set<ImportField>([
    "paymentDate",
    "amount",
    "currency",
    "payerName",
    "payerId",
    "description",
    "bankReference",
    "achId",
    "wireId",
    "memo",
    "transactionId",
    "accountId",
  ]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function savedColumnMappingForHeaders(
  value: unknown,
  headers: string[],
  kind: ImportKind,
): ColumnMapping | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > FIELDS_BY_KIND[kind].size) return null;

  const availableHeaders = new Set(headers);
  const mapping: ColumnMapping = {};
  for (const [field, header] of entries) {
    if (!FIELDS_BY_KIND[kind].has(field as ImportField)) return null;
    if (typeof header !== "string" || !header.trim() || !availableHeaders.has(header)) return null;
    mapping[field as ImportField] = header;
  }
  return mapping;
}

export function newestCompatibleSavedColumnMapping(
  values: unknown[],
  headers: string[],
  kind: ImportKind,
): ColumnMapping | null {
  for (const value of values) {
    const mapping = savedColumnMappingForHeaders(value, headers, kind);
    if (mapping) return mapping;
  }
  return null;
}
