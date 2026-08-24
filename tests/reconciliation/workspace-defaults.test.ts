import { describe, expect, it } from "vitest";
import { parseWorkspaceReconciliationDefaults } from "@/lib/reconciliation/workspace-defaults";

describe("workspace reconciliation defaults", () => {
  it("uses the workspace currency and both configured date boundaries", () => {
    expect(parseWorkspaceReconciliationDefaults({
      currency_code: "cad",
      match_days_before: 7,
      match_days_after: 45,
    })).toEqual({
      currencyCode: "CAD",
      config: { earlyPaymentAllowanceDays: 7, dateWindowDays: 45 },
    });
  });

  it.each([
    { currency_code: "US", match_days_before: 3, match_days_after: 90 },
    { currency_code: "USD", match_days_before: -1, match_days_after: 90 },
    { currency_code: "USD", match_days_before: 3, match_days_after: 0 },
    { currency_code: "USD", match_days_before: 3, match_days_after: 366 },
    { currency_code: "USD", match_days_before: 1.5, match_days_after: 90 },
    { currency_code: "USD", match_days_before: null, match_days_after: 90 },
    { currency_code: "USD", match_days_before: 3, match_days_after: "" },
    { currency_code: "USD", match_days_before: false, match_days_after: 90 },
  ])("fails closed for invalid persisted defaults", (workspace) => {
    expect(parseWorkspaceReconciliationDefaults(workspace)).toBeNull();
  });
});
