const LEGAL_SUFFIXES = new Set([
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "INC",
  "INCORPORATED",
  "LLC",
  "LLP",
  "LP",
  "LTD",
  "LIMITED",
  "PLC",
]);

const BANK_NOISE = new Set([
  "ACH",
  "CREDIT",
  "DEPOSIT",
  "ORIG",
  "ORIGINATOR",
  "PAYMENT",
  "PMT",
  "RECEIVED",
  "TRANSFER",
  "WIRE",
]);

export function normalizeReference(value: string | undefined): string {
  return (value ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function normalizeEntityName(value: string | undefined): string {
  const tokens = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIXES.has(token) && !BANK_NOISE.has(token));

  return tokens.join(" ");
}

function bigrams(value: string): Map<string, number> {
  const compact = value.replace(/\s/g, "");
  const result = new Map<string, number>();
  if (compact.length < 2) {
    if (compact) result.set(compact, 1);
    return result;
  }
  for (let index = 0; index < compact.length - 1; index += 1) {
    const pair = compact.slice(index, index + 2);
    result.set(pair, (result.get(pair) ?? 0) + 1);
  }
  return result;
}

export function nameSimilarity(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = normalizeEntityName(left);
  const normalizedRight = normalizeEntityName(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const compactLeft = normalizedLeft.replace(/\s/g, "");
  const compactRight = normalizedRight.replace(/\s/g, "");
  const shorter = compactLeft.length <= compactRight.length ? compactLeft : compactRight;
  const longer = compactLeft.length > compactRight.length ? compactLeft : compactRight;
  const prefixScore = longer.startsWith(shorter) && shorter.length >= 4
    ? shorter.length / longer.length
    : 0;

  const leftPairs = bigrams(normalizedLeft);
  const rightPairs = bigrams(normalizedRight);
  let intersection = 0;
  for (const [pair, count] of leftPairs) {
    intersection += Math.min(count, rightPairs.get(pair) ?? 0);
  }
  const leftCount = [...leftPairs.values()].reduce((total, count) => total + count, 0);
  const rightCount = [...rightPairs.values()].reduce((total, count) => total + count, 0);
  const dice = leftCount + rightCount === 0 ? 0 : (2 * intersection) / (leftCount + rightCount);
  return Math.max(prefixScore, dice);
}

export function dateDifferenceDays(later: string, earlier: string): number {
  const laterTime = Date.parse(`${later.slice(0, 10)}T00:00:00Z`);
  const earlierTime = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(laterTime) || !Number.isFinite(earlierTime)) return Number.POSITIVE_INFINITY;
  return Math.round((laterTime - earlierTime) / 86_400_000);
}

export function paymentSearchText(payment: {
  description?: string;
  bankReference?: string;
  achId?: string;
  wireId?: string;
  memo?: string;
  transactionId?: string;
}): string {
  return normalizeReference([
    payment.description,
    payment.bankReference,
    payment.achId,
    payment.wireId,
    payment.memo,
    payment.transactionId,
  ].filter(Boolean).join(" "));
}

export function invoiceReferences(invoice: {
  invoiceNumber: string;
  reference?: string;
  purchaseOrder?: string;
}): string[] {
  return [invoice.invoiceNumber, invoice.reference, invoice.purchaseOrder]
    .map(normalizeReference)
    .filter((reference) => reference.length >= 4);
}

export function paymentContainsInvoiceReference(
  payment: Parameters<typeof paymentSearchText>[0],
  invoice: Parameters<typeof invoiceReferences>[0],
): boolean {
  const searchText = paymentSearchText(payment);
  return invoiceReferences(invoice).some((reference) => searchText.includes(reference));
}
