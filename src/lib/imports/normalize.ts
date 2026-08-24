import type { Invoice, InvoiceStatus, Payment } from "../reconciliation/types";
import { canonicalInvoiceIdentity, canonicalPaymentIdentity } from "../reconciliation/identity";
import { mappingFromSuggestions, suggestColumns } from "./columns";
import type {
  ColumnMapping,
  ImportField,
  ImportIssue,
  ImportNormalizationResult,
  ImportOptions,
  NormalizedImportRow,
  RawImportRow,
} from "./types";
import { excelCellValue, normalizeCurrency, parseDate, parseMoney, stringValue } from "./values";

function rawValue(row: RawImportRow, mapping: ColumnMapping, field: ImportField): unknown {
  const header = mapping[field];
  return header ? row[header] : undefined;
}

function isBlankRow(row: RawImportRow): boolean {
  return Object.values(row).every((value) => stringValue(value) === "");
}

function requiredIssue(field: ImportField, rowNumber: number): ImportIssue {
  return { code: "missing_required_value", field, row: rowNumber, message: `A value is required for ${field}.` };
}

function normalizeStatus(value: unknown, balance: number): InvoiceStatus {
  const status = stringValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "void" || status === "voided" || status === "cancelled" || status === "canceled") return "void";
  if (status === "paid" || status === "closed") return "paid";
  if (status === "partially_paid" || status === "partial") return "partially_paid";
  return balance > 0 ? "open" : "paid";
}

function normalizeInvoiceRowInternal(
  row: RawImportRow,
  mapping: ColumnMapping,
  rowNumber: number,
  options: ImportOptions,
): NormalizedImportRow<Invoice> {
  const issues: ImportIssue[] = [];
  const invoiceNumber = stringValue(rawValue(row, mapping, "invoiceNumber"));
  const customerName = stringValue(rawValue(row, mapping, "customerName"));
  const invoiceDate = parseDate(rawValue(row, mapping, "invoiceDate"), options.dateOrder);
  const dueDateValue = rawValue(row, mapping, "dueDate");
  const dueDate = stringValue(dueDateValue) ? parseDate(dueDateValue, options.dateOrder) : undefined;
  const original = parseMoney(rawValue(row, mapping, "originalAmount"));
  const outstandingRaw = rawValue(row, mapping, "outstandingBalance");
  const outstanding = stringValue(outstandingRaw) ? parseMoney(outstandingRaw) : original;
  const currencyValue = rawValue(row, mapping, "currency");
  const detectedCurrency = original?.currencyHint ?? outstanding?.currencyHint;
  const invoiceCurrency = normalizeCurrency(currencyValue, detectedCurrency ?? options.defaultCurrency ?? "USD");

  if (!invoiceNumber) issues.push(requiredIssue("invoiceNumber", rowNumber));
  if (!customerName) issues.push(requiredIssue("customerName", rowNumber));
  if (!invoiceDate) issues.push({ code: "invalid_date", field: "invoiceDate", row: rowNumber, value: rawValue(row, mapping, "invoiceDate"), message: "The invoice date is missing or invalid." });
  if (stringValue(dueDateValue) && !dueDate) issues.push({ code: "invalid_date", field: "dueDate", row: rowNumber, value: dueDateValue, message: "The due date is invalid." });
  if (invoiceDate && dueDate && dueDate < invoiceDate) issues.push({ code: "invalid_date", field: "dueDate", row: rowNumber, value: dueDateValue, message: "The due date cannot be earlier than the invoice date." });
  if (!original || original.minor <= 0) issues.push({ code: "invalid_amount", field: "originalAmount", row: rowNumber, value: rawValue(row, mapping, "originalAmount"), message: "The original amount must be greater than zero." });
  if (!outstanding || outstanding.minor < 0 || (original && outstanding.minor > original.minor)) issues.push({ code: "invalid_amount", field: "outstandingBalance", row: rowNumber, value: outstandingRaw, message: "The outstanding balance must be between zero and the original amount." });
  if (!invoiceCurrency) issues.push({ code: "invalid_currency", field: "currency", row: rowNumber, value: currencyValue, message: "Currency must be a three-letter ISO code." });

  const normalized: NormalizedImportRow<Invoice> = { rowNumber, raw: row, issues };
  if (issues.length > 0 || !invoiceDate || !original || !outstanding || !invoiceCurrency) return normalized;
  normalized.value = {
    id: `${options.idPrefix ?? "invoice"}-${options.sourceImportId ?? "import"}-${rowNumber}`,
    invoiceNumber,
    customerName,
    customerId: stringValue(rawValue(row, mapping, "customerId")) || undefined,
    customerEmail: stringValue(rawValue(row, mapping, "customerEmail")) || undefined,
    invoiceDate,
    dueDate,
    originalAmountMinor: original.minor,
    outstandingAmountMinor: outstanding.minor,
    currency: invoiceCurrency,
    status: normalizeStatus(rawValue(row, mapping, "status"), outstanding.minor),
    reference: stringValue(rawValue(row, mapping, "reference")) || undefined,
    purchaseOrder: stringValue(rawValue(row, mapping, "purchaseOrder")) || undefined,
    memo: stringValue(rawValue(row, mapping, "memo")) || undefined,
    accountId: stringValue(rawValue(row, mapping, "accountId")) || undefined,
    sourceImportId: options.sourceImportId,
    sourceRow: rowNumber,
  };
  return normalized;
}

function normalizePaymentRowInternal(
  row: RawImportRow,
  mapping: ColumnMapping,
  rowNumber: number,
  options: ImportOptions,
): NormalizedImportRow<Payment> {
  const issues: ImportIssue[] = [];
  const paymentDate = parseDate(rawValue(row, mapping, "paymentDate"), options.dateOrder);
  const amount = parseMoney(rawValue(row, mapping, "amount"));
  const paymentCurrency = normalizeCurrency(
    rawValue(row, mapping, "currency"),
    amount?.currencyHint ?? options.defaultCurrency ?? "USD",
  );
  if (!paymentDate) issues.push({ code: "invalid_date", field: "paymentDate", row: rowNumber, value: rawValue(row, mapping, "paymentDate"), message: "The payment date is missing or invalid." });
  if (!amount || amount.minor <= 0) issues.push({ code: "invalid_amount", field: "amount", row: rowNumber, value: rawValue(row, mapping, "amount"), message: "The payment amount must be greater than zero." });
  if (!paymentCurrency) issues.push({ code: "invalid_currency", field: "currency", row: rowNumber, value: rawValue(row, mapping, "currency"), message: "Currency must be a three-letter ISO code." });
  const normalized: NormalizedImportRow<Payment> = { rowNumber, raw: row, issues };
  if (issues.length > 0 || !paymentDate || !amount || !paymentCurrency) return normalized;
  normalized.value = {
    id: `${options.idPrefix ?? "payment"}-${options.sourceImportId ?? "import"}-${rowNumber}`,
    paymentDate,
    amountMinor: amount.minor,
    currency: paymentCurrency,
    payerName: stringValue(rawValue(row, mapping, "payerName")) || undefined,
    payerId: stringValue(rawValue(row, mapping, "payerId")) || undefined,
    description: stringValue(rawValue(row, mapping, "description")) || undefined,
    bankReference: stringValue(rawValue(row, mapping, "bankReference")) || undefined,
    achId: stringValue(rawValue(row, mapping, "achId")) || undefined,
    wireId: stringValue(rawValue(row, mapping, "wireId")) || undefined,
    memo: stringValue(rawValue(row, mapping, "memo")) || undefined,
    transactionId: stringValue(rawValue(row, mapping, "transactionId")) || undefined,
    accountId: stringValue(rawValue(row, mapping, "accountId")) || undefined,
    sourceImportId: options.sourceImportId,
    sourceRow: rowNumber,
  };
  return normalized;
}

function duplicateKey(value: Invoice | Payment): string {
  return "invoiceNumber" in value
    ? canonicalInvoiceIdentity(value)
    : canonicalPaymentIdentity(value);
}

function normalizeRows<T extends Invoice | Payment>(
  rows: RawImportRow[],
  normalize: (row: RawImportRow, rowNumber: number) => NormalizedImportRow<T>,
): ImportNormalizationResult<T> {
  const accepted: NormalizedImportRow<T>[] = [];
  const rejected: NormalizedImportRow<T>[] = [];
  const skippedBlankRows: number[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (isBlankRow(row)) {
      skippedBlankRows.push(rowNumber);
      return;
    }
    const result = normalize(row, rowNumber);
    if (result.value) {
      const key = duplicateKey(result.value);
      const firstRow = seen.get(key);
      if (firstRow !== undefined) {
        const issue: ImportIssue = { code: "duplicate_row", row: rowNumber, message: `This row duplicates row ${firstRow} and was not imported twice.` };
        result.issues.push(issue);
        issues.push(issue);
        result.value = undefined;
      } else {
        seen.set(key, rowNumber);
      }
    }
    if (result.value) accepted.push(result);
    else rejected.push(result);
    issues.push(...result.issues.filter((issue) => !issues.includes(issue)));
  });
  return { accepted, rejected, skippedBlankRows, issues };
}

export function normalizeInvoiceRows(
  rows: RawImportRow[],
  mapping: ColumnMapping,
  options: ImportOptions = {},
): ImportNormalizationResult<Invoice> {
  return normalizeRows(rows, (row, rowNumber) => normalizeInvoiceRowInternal(row, mapping, rowNumber, options));
}

export function normalizePaymentRows(
  rows: RawImportRow[],
  mapping: ColumnMapping,
  options: ImportOptions = {},
): ImportNormalizationResult<Payment> {
  return normalizeRows(rows, (row, rowNumber) => normalizePaymentRowInternal(row, mapping, rowNumber, options));
}

export function worksheetRowsToObjects(rows: unknown[][]): { headers: string[]; rows: RawImportRow[] } {
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((value, index) => stringValue(excelCellValue(value)) || `Column ${index + 1}`);
  return {
    headers,
    rows: dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, excelCellValue(row[index])]))),
  };
}

export function normalizeInvoiceWorksheet(rows: unknown[][], options: ImportOptions = {}): ImportNormalizationResult<Invoice> {
  const converted = worksheetRowsToObjects(rows);
  return normalizeInvoiceRows(converted.rows, mappingFromSuggestions(suggestColumns(converted.headers, "invoice")), options);
}

export function normalizePaymentWorksheet(rows: unknown[][], options: ImportOptions = {}): ImportNormalizationResult<Payment> {
  const converted = worksheetRowsToObjects(rows);
  return normalizePaymentRows(converted.rows, mappingFromSuggestions(suggestColumns(converted.headers, "payment")), options);
}
