import "server-only";

import { File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintImport, parseCsv } from "./csv";
import { mappingFromSuggestions, suggestColumns } from "./columns";
import { decodeSafeCsv } from "./file-safety";
import { newestCompatibleSavedColumnMapping } from "./saved-mapping";
import type { ImportKind } from "./types";

const sampleDirectory = join(dirname(fileURLToPath(import.meta.url)), "samples");

export const bundledSampleFiles = {
  invoice: "northstar-invoices.csv",
  payment: "northstar-payments.csv",
} as const;

export type BundledSampleFile = {
  kind: ImportKind;
  fileName: string;
  bytes: Uint8Array;
};

export async function readBundledSample(kind: ImportKind): Promise<BundledSampleFile> {
  const fileName = bundledSampleFiles[kind];
  const bytes = await readFile(join(sampleDirectory, fileName));
  return { kind, fileName, bytes: new Uint8Array(bytes) };
}

export function bundledSampleAsFile(sample: BundledSampleFile) {
  return new NodeFile([sample.bytes], sample.fileName, { type: "text/csv" }) as unknown as File;
}

export function previewBundledSample(sample: BundledSampleFile, savedMappings: unknown[] = []) {
  const parsed = parseCsv(decodeSafeCsv(sample.bytes));
  if (parsed.headers.length === 0) {
    throw new Error("empty_headers");
  }
  const suggestions = suggestColumns(parsed.headers, sample.kind);
  const savedMapping = newestCompatibleSavedColumnMapping(savedMappings, parsed.headers, sample.kind);
  const mapping = savedMapping || mappingFromSuggestions(suggestions);
  return {
    file: {
      name: sample.fileName,
      size: sample.bytes.byteLength,
      fingerprint: fingerprintImport(sample.bytes),
    },
    kind: sample.kind,
    headers: parsed.headers,
    rowCount: parsed.rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim())).length,
    preview: parsed.rows.slice(0, 8),
    suggestions,
    mapping,
    mappingSource: savedMapping ? "saved" as const : "detected" as const,
    issues: parsed.issues.slice(0, 20),
    sheets: [] as string[],
    selectedSheet: undefined as string | undefined,
    sample: true as const,
  };
}
