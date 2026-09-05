import { describe, expect, it } from "vitest";
import { recommendPlan } from "@/lib/billing/plan-recommendation";

describe("smallest appropriate plan", () => {
  it.each([[0, "free"], [50, "free"], [51, "solo"], [500, "solo"], [501, "business"], [2500, "business"], [2501, "bookkeeper"], [10000, "bookkeeper"]])("recommends for %i payments", (payments, key) => {
    expect(recommendPlan(payments as number, 1, false)?.key).toBe(key);
  });
  it("accounts for client workspaces and gated features", () => {
    expect(recommendPlan(20, 2, false)?.key).toBe("business");
    expect(recommendPlan(20, 4, false)?.key).toBe("bookkeeper");
    expect(recommendPlan(20, 1, true)?.key).toBe("business");
  });
  it.each([[10001, 1], [1, 21], [-1, 1], [1.5, 1], [1, 0], [NaN, 1], [Infinity, 1]])("does not overpromise invalid or unsupported requirements", (payments, workspaces) => {
    expect(recommendPlan(payments, workspaces, false)).toBeNull();
  });
});
