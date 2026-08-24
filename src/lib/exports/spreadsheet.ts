const FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;

/** Keep user-controlled text from being interpreted as a spreadsheet formula. */
export function neutralizeSpreadsheetValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function quoteCsvCell(value: unknown) {
  const safe = String(neutralizeSpreadsheetValue(value) ?? "");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function safeSpreadsheetRows(rows: unknown[][]) {
  return rows.map((row) => row.map(neutralizeSpreadsheetValue));
}
