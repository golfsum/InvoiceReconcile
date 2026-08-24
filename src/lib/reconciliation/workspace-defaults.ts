import type { ReconciliationConfig } from "./types";

export type WorkspaceReconciliationDefaults = {
  currencyCode: string;
  config: Pick<ReconciliationConfig, "earlyPaymentAllowanceDays" | "dateWindowDays">;
};

export function parseWorkspaceReconciliationDefaults(workspace: {
  currency_code: unknown;
  match_days_before: unknown;
  match_days_after: unknown;
}): WorkspaceReconciliationDefaults | null {
  if (typeof workspace.currency_code !== "string"
      || typeof workspace.match_days_before !== "number"
      || typeof workspace.match_days_after !== "number") return null;
  const currencyCode = workspace.currency_code.trim().toUpperCase();
  const matchDaysBefore = workspace.match_days_before;
  const matchDaysAfter = workspace.match_days_after;
  if (!/^[A-Z]{3}$/.test(currencyCode)
      || !Number.isInteger(matchDaysBefore)
      || matchDaysBefore < 0
      || matchDaysBefore > 365
      || !Number.isInteger(matchDaysAfter)
      || matchDaysAfter < 1
      || matchDaysAfter > 365) return null;
  return {
    currencyCode,
    config: {
      earlyPaymentAllowanceDays: matchDaysBefore,
      dateWindowDays: matchDaysAfter,
    },
  };
}
