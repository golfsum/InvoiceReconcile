export interface ParsedMoney {
  minor: number;
  currencyHint?: string;
}

const SYMBOL_CURRENCIES: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

export function excelCellValue(value: unknown): unknown {
  if (value instanceof Date || value === null || typeof value !== "object") return value;
  const cell = value as Record<string, unknown>;
  if ("result" in cell) return excelCellValue(cell.result);
  if (typeof cell.text === "string") return cell.text;
  if (Array.isArray(cell.richText)) {
    return cell.richText
      .map((item) => typeof item === "object" && item && "text" in item ? String((item as { text: unknown }).text) : "")
      .join("");
  }
  if ("hyperlink" in cell && typeof cell.hyperlink === "string") return cell.text ?? cell.hyperlink;
  return value;
}

export function stringValue(value: unknown): string {
  const scalar = excelCellValue(value);
  if (scalar === null || scalar === undefined) return "";
  if (scalar instanceof Date) return scalar.toISOString();
  return String(scalar).trim();
}

export function parseMoney(value: unknown): ParsedMoney | undefined {
  const scalar = excelCellValue(value);
  if (typeof scalar === "number") {
    if (!Number.isFinite(scalar)) return undefined;
    return { minor: Math.round(scalar * 100) };
  }
  let text = stringValue(scalar);
  if (!text) return undefined;
  const symbol = Object.keys(SYMBOL_CURRENCIES).find((candidate) => text.includes(candidate));
  const currencyCode = text.match(/\b[A-Z]{3}\b/i)?.[0]?.toUpperCase();
  const negative = /^\s*\(.*\)\s*$/.test(text) || /^\s*-/.test(text);
  text = text.replace(/[()\sA-Za-z$€£¥]/g, "").replace(/^-/, "");
  if (!text || !/[0-9]/.test(text)) return undefined;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    text = text.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const digitsAfter = text.length - lastComma - 1;
    text = digitsAfter === 2 ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else {
    text = text.replace(/,/g, "");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  return {
    minor: Math.round(parsed * 100) * (negative ? -1 : 1),
    currencyHint: currencyCode ?? (symbol ? SYMBOL_CURRENCIES[symbol] : undefined),
  };
}

function validDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: unknown, dateOrder: "MDY" | "DMY" = "MDY"): string | undefined {
  const scalar = excelCellValue(value);
  if (scalar instanceof Date && Number.isFinite(scalar.getTime())) return scalar.toISOString().slice(0, 10);
  if (typeof scalar === "number") {
    if (!Number.isFinite(scalar) || scalar < 1 || scalar > 2_958_465) return undefined;
    const milliseconds = Date.UTC(1899, 11, 30) + Math.floor(scalar) * 86_400_000;
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  const text = stringValue(scalar);
  if (!text) return undefined;
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const yearValue = Number(numeric[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    const month = dateOrder === "MDY" ? first : second;
    const day = dateOrder === "MDY" ? second : first;
    return validDate(year, month, day);
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function normalizeCurrency(value: unknown, fallback = "USD"): string | undefined {
  const normalized = stringValue(value || fallback).toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}
