import type { Invoice, Payment } from "../reconciliation";

export type RawImportRow = Record<string, unknown>;
export type ImportKind = "invoice" | "payment";

export type InvoiceImportField =
  | "invoiceNumber"
  | "customerName"
  | "customerId"
  | "customerEmail"
  | "invoiceDate"
  | "dueDate"
  | "originalAmount"
  | "outstandingBalance"
  | "currency"
  | "status"
  | "reference"
  | "purchaseOrder"
  | "memo"
  | "accountId";

export type PaymentImportField =
  | "paymentDate"
  | "amount"
  | "currency"
  | "payerName"
  | "payerId"
  | "description"
  | "bankReference"
  | "achId"
  | "wireId"
  | "memo"
  | "transactionId"
  | "accountId";

export type ImportField = InvoiceImportField | PaymentImportField;
export type ColumnMapping = Partial<Record<ImportField, string>>;

export interface ColumnSuggestion {
  field: ImportField;
  header: string;
  confidence: "exact" | "likely";
}

export type ImportIssueCode =
  | "blank_row"
  | "invalid_csv"
  | "missing_required_value"
  | "invalid_amount"
  | "invalid_date"
  | "invalid_currency"
  | "duplicate_row"
  | "duplicate_across_imports"
  | "duplicate_file";

export interface ImportIssue {
  code: ImportIssueCode;
  message: string;
  row?: number;
  field?: ImportField;
  value?: unknown;
}

export interface NormalizedImportRow<T extends Invoice | Payment> {
  rowNumber: number;
  raw: RawImportRow;
  value?: T;
  issues: ImportIssue[];
}

export interface ImportNormalizationResult<T extends Invoice | Payment> {
  accepted: NormalizedImportRow<T>[];
  rejected: NormalizedImportRow<T>[];
  skippedBlankRows: number[];
  issues: ImportIssue[];
}

export interface ImportOptions {
  defaultCurrency?: string;
  dateOrder?: "MDY" | "DMY";
  sourceImportId?: string;
  idPrefix?: string;
}

export interface CsvParseResult {
  headers: string[];
  rows: RawImportRow[];
  issues: ImportIssue[];
}
