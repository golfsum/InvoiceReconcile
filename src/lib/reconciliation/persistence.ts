import { createHash } from "node:crypto";
import type {
  ColumnMapping,
  ImportNormalizationResult,
  RawImportRow,
} from "@/lib/imports";
import type { Invoice, Payment } from "./types";
import type { ReconciliationRunContext } from "./workspace-data";

type DurableRecord = Invoice | Payment;

export type DurableImportRow = {
  rowNumber: number;
  disposition: "accepted" | "rejected" | "duplicate" | "blank";
  rawValues: RawImportRow;
  normalizedValues: DurableRecord | Record<string, never>;
  issueCodes: string[];
};

export type DurableImport = {
  originalFilename: string;
  sourceType: "csv" | "xlsx";
  contentType: "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  byteSize: number;
  sha256: string;
  sheetName?: string;
  columnMapping: ColumnMapping;
  sourceHeaders: string[];
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  blankRows: number;
  rows: DurableImportRow[];
};

type DurableImportInput<T extends DurableRecord> = {
  fileName: string;
  fileSize: number;
  sha256: string;
  sheetName?: string;
  headers: string[];
  rows: RawImportRow[];
  mapping: ColumnMapping;
  normalization: ImportNormalizationResult<T>;
};

function sourceType(fileName: string): "csv" | "xlsx" {
  return fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
}

export function buildDurableImport<T extends DurableRecord>(input: DurableImportInput<T>): DurableImport {
  const accepted = new Map(input.normalization.accepted.map((row) => [row.rowNumber, row]));
  const rejected = new Map(input.normalization.rejected.map((row) => [row.rowNumber, row]));
  const blanks = new Set(input.normalization.skippedBlankRows);
  let duplicateRows = 0;
  let rejectedRows = 0;

  const rows = input.rows.map((rawValues, index): DurableImportRow => {
    const rowNumber = index + 2;
    const normalized = accepted.get(rowNumber) || rejected.get(rowNumber);
    const issueCodes = normalized?.issues.map((issue) => issue.code) || [];
    let disposition: DurableImportRow["disposition"];
    if (blanks.has(rowNumber)) disposition = "blank";
    else if (accepted.has(rowNumber)) disposition = "accepted";
    else if (issueCodes.includes("duplicate_row")) {
      disposition = "duplicate";
      duplicateRows += 1;
    } else {
      disposition = "rejected";
      rejectedRows += 1;
    }
    return {
      rowNumber,
      disposition,
      rawValues,
      normalizedValues: normalized?.value || {},
      issueCodes,
    };
  });

  const type = sourceType(input.fileName);
  return {
    originalFilename: input.fileName,
    sourceType: type,
    contentType: type === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
    byteSize: input.fileSize,
    sha256: input.sha256,
    sheetName: input.sheetName,
    columnMapping: input.mapping,
    sourceHeaders: input.headers,
    totalRows: input.rows.length,
    acceptedRows: input.normalization.accepted.length,
    rejectedRows,
    duplicateRows,
    blankRows: input.normalization.skippedBlankRows.length,
    rows,
  };
}

function stableMapping(mapping: ColumnMapping) {
  return JSON.stringify(Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)));
}

export function reconciliationRunKey(
  invoiceFingerprint: string,
  paymentFingerprint: string,
  invoiceMapping: ColumnMapping,
  paymentMapping: ColumnMapping,
  mappingFingerprint: (value: string) => string,
  context?: ReconciliationRunContext,
) {
  const stableInvoiceMapping = stableMapping(invoiceMapping);
  const stablePaymentMapping = stableMapping(paymentMapping);
  const behavior = [
    "reconciliation-run-v2",
    invoiceFingerprint,
    paymentFingerprint,
    stableInvoiceMapping,
    stablePaymentMapping,
    mappingFingerprint(`${stableInvoiceMapping}|${stablePaymentMapping}`),
    context?.defaultCurrency || "default",
    context?.earlyPaymentAllowanceDays ?? "default",
    context?.dateWindowDays ?? "default",
    context?.payerMappingFingerprint || "none",
  ];
  // Omitting the optional custom-rule field preserves the no-custom behavior
  // payload while making every eligible rule set part of the durable identity.
  if (context?.matchingRuleFingerprint) behavior.push(context.matchingRuleFingerprint);
  const behaviorKey = createHash("sha256").update(behavior.join("|")).digest("hex");
  return `${invoiceFingerprint.slice(0, 32)}-${paymentFingerprint.slice(0, 32)}-${behaviorKey}`;
}
