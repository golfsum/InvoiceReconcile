import { describe, expect, it } from "vitest";
import {
  parseReconciliationEntitlement,
  paymentLimitResponse,
} from "@/lib/billing/entitlements";
import {
  billingPathForPlan,
  onboardingPathForPlan,
  selectedOrganizationId,
  selectedPaidPlan,
  selectedPaidPlanFromMetadata,
} from "@/lib/billing/intent";

describe("billing entitlements", () => {
  it("parses an allowed capacity reservation", () => {
    expect(parseReconciliationEntitlement({
      allowed: true,
      code: "allowed",
      plan: "business",
      limit: 2500,
      used: 1100,
      requested: 200,
      remaining: 1200,
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      existing: false,
      reservation_id: "f0be0df5-06d8-4b4c-860d-f52045b33c88",
    })).toMatchObject({ allowed: true, plan: "business", remaining: 1200 });
  });

  it("creates a structured upgrade response for a denied run", () => {
    const entitlement = parseReconciliationEntitlement({
      allowed: false,
      code: "payment_limit_exceeded",
      plan: "free",
      limit: 20,
      used: 15,
      requested: 10,
      remaining: 5,
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      existing: false,
    });
    expect(entitlement?.allowed).toBe(false);
    if (!entitlement || entitlement.allowed) return;
    expect(paymentLimitResponse(entitlement)).toEqual({
      error: "This run includes 10 payments, which would exceed the 20-payment monthly limit on the Free plan.",
      code: "payment_limit_exceeded",
      upgradeRequired: true,
      upgradeUrl: "/settings/billing",
      entitlement: {
        plan: "free",
        limit: 20,
        used: 15,
        requested: 10,
        remaining: 5,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
      },
    });
  });

  it("rejects malformed database entitlement results", () => {
    expect(parseReconciliationEntitlement({ allowed: false, code: "payment_limit_exceeded" })).toBeNull();
    expect(parseReconciliationEntitlement({
      allowed: true,
      code: "allowed",
      plan: "enterprise",
      limit: 100000,
      used: 0,
      requested: 1,
      remaining: 99999,
      period_start: "not-a-date",
      period_end: "2026-08-31",
      existing: false,
    })).toBeNull();
    expect(parseReconciliationEntitlement({
      allowed: true,
      code: "allowed",
      plan: "free",
      limit: 20,
      used: 0,
      requested: 20,
      remaining: 0,
      period_start: "2026-09-01T00:00:00.000Z",
      period_end: "2026-09-30T23:59:59.999Z",
      existing: false,
    })).toMatchObject({ allowed: true, period_start: "2026-09-01", period_end: "2026-09-30" });
  });
});

describe("paid plan intent", () => {
  const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";

  it("allowlists paid plans at query, metadata, and redirect boundaries", () => {
    expect(selectedPaidPlan("solo")).toBe("solo");
    expect(selectedPaidPlan(["business", "bookkeeper"])).toBe("business");
    expect(selectedPaidPlan("free")).toBeNull();
    expect(selectedPaidPlan("solo&next=https://attacker.example")).toBeNull();
    expect(selectedPaidPlanFromMetadata({ selected_plan: "bookkeeper" })).toBe("bookkeeper");
    expect(selectedPaidPlanFromMetadata({ selected_plan: { plan: "solo" } })).toBeNull();
  });

  it("builds only internal onboarding and billing destinations", () => {
    expect(onboardingPathForPlan("business")).toBe("/onboarding?plan=business");
    expect(onboardingPathForPlan(null)).toBe("/onboarding");
    expect(billingPathForPlan("solo", organizationId)).toBe(
      `/settings/billing?plan=solo&organizationId=${organizationId}&onboarding=complete`,
    );
    expect(selectedOrganizationId(organizationId)).toBe(organizationId);
    expect(selectedOrganizationId("../../admin")).toBeNull();
  });
});
