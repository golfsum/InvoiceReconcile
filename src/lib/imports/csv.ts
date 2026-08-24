import Papa from "papaparse";
import type { CsvParseResult, ImportIssue, RawImportRow } from "./types";

export function parseCsv(content: string): CsvParseResult {
  if (!content.trim()) {
    return { headers: [], rows: [], issues: [{ code: "invalid_csv", message: "The CSV file is empty." }] };
  }
  const parsed = Papa.parse<RawImportRow>(content.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });
  const issues: ImportIssue[] = parsed.errors.map((error) => ({
    code: "invalid_csv",
    message: error.message,
    row: typeof error.row === "number" ? error.row + 2 : undefined,
  }));
  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data,
    issues,
  };
}

export function fingerprintImport(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content.replace(/\r\n/g, "\n")) : content;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first ^= byte;
    first = Math.imul(first, 0x01000193);
    second ^= byte + 0x9d;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${bytes.length.toString(16)}-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function checkDuplicateImport(fingerprint: string, previousFingerprints: Iterable<string>): ImportIssue | undefined {
  return new Set(previousFingerprints).has(fingerprint)
    ? { code: "duplicate_file", message: "This exact source file has already been imported." }
    : undefined;
}
