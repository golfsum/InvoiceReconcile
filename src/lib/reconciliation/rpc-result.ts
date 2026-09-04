export function asRpcRecord(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  if (Array.isArray(parsed) && parsed.length === 1) return asRpcRecord(parsed[0]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseJsonObject(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function asIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const match = date.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  return match?.[1] ?? null;
}

function asNonNegativeInt(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function normalizeEntitlementRpc(value: unknown): unknown {
  const record = asRpcRecord(value);
  if (!record) return value;
  const periodStart = asIsoDate(record.period_start);
  const periodEnd = asIsoDate(record.period_end);
  const used = asNonNegativeInt(record.used);
  const limit = asNonNegativeInt(record.limit);
  const requested = asNonNegativeInt(record.requested);
  const remaining = asNonNegativeInt(record.remaining);
  const allowed = asBoolean(record.allowed);
  const existing = asBoolean(record.existing);
  return {
    ...record,
    ...(allowed !== null ? { allowed } : {}),
    ...(existing !== null ? { existing } : {}),
    ...(limit !== null ? { limit } : {}),
    ...(used !== null ? { used } : {}),
    ...(requested !== null ? { requested } : {}),
    ...(remaining !== null ? { remaining } : {}),
    ...(periodStart ? { period_start: periodStart } : {}),
    ...(periodEnd ? { period_end: periodEnd } : {}),
  };
}

export function parsePersistRpcResult(value: unknown): {
  runRecordId: string;
  savedAt: string;
  canonicalCounts?: {
    newPayments: number;
    existingPayments: number;
    carriedPayments: number;
    resolvedPayments: number;
    existingInvoices: number;
  };
} | null {
  const record = asRpcRecord(value);
  if (!record) return null;
  const runRecordId = typeof record.run_record_id === "string" ? record.run_record_id : null;
  if (!runRecordId) return null;
  const savedAt = persistTimestamp(record.saved_at);
  if (!savedAt) return null;
  const rawCounts = [
    record.new_payment_count,
    record.duplicate_payment_count,
    record.carried_payment_count,
    record.resolved_payment_count,
    record.duplicate_invoice_count,
  ].map(asNonNegativeInt);
  const canonicalCounts = rawCounts.every((count): count is number => count !== null)
    ? {
        newPayments: rawCounts[0],
        existingPayments: rawCounts[1],
        carriedPayments: rawCounts[2],
        resolvedPayments: rawCounts[3],
        existingInvoices: rawCounts[4],
      }
    : undefined;
  return { runRecordId, savedAt, canonicalCounts };
}

function persistTimestamp(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

export function persistFailureKind(code: string | undefined) {
  if (code === "42501") return "forbidden" as const;
  if (code === "40001") return "conflict" as const;
  if (code === "23505" || code === "23503" || code === "23514" || code === "22023" || code === "P0001") {
    return "records" as const;
  }
  return "unavailable" as const;
}

export function persistFailureMessage(kind: ReturnType<typeof persistFailureKind>, sample: boolean) {
  if (kind === "conflict") return "Workspace records changed while this run was saving. Run matching again.";
  if (kind === "records") {
    return sample
      ? "The sample run could not be saved against the current workspace records. Try again in a few minutes."
      : "This reconciliation could not be saved against the current workspace records. Try again in a few minutes.";
  }
  return sample
    ? "The sample run could not be saved to this workspace. Try again in a few minutes."
    : "The reconciliation could not be securely authorized and saved, so no workspace run was created. Retry when durable storage is available.";
}
