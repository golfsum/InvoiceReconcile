import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "@/lib/auth/access";

vi.mock("server-only", () => ({}));
const resolveOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/http", () => ({ resolveBillingOrganization: resolveOrganization }));
import { loadBillingSummary } from "@/lib/billing/summary";

const user = { id: "qa-user", source: "supabase" } as AppUser;
const row = { plan_code: "business", status: "active", provider_customer_id: "cus_qa", provider_subscription_id: "sub_qa", current_period_ends_at: "2026-10-04T00:00:00+00:00", cancel_at_period_end: false };
const single = vi.fn();
const eq = vi.fn(() => ({ maybeSingle: single }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
beforeEach(() => {
  vi.clearAllMocks();
  resolveOrganization.mockResolvedValue({ ok: true, organizationId: "owned-org", supabase: { from } });
  single.mockResolvedValue({ data: row, error: null });
});

describe("billing summary", () => {
  it("uses the authenticated admin resolution and scopes the saved subscription", async () => {
    const result = await loadBillingSummary(user, "requested-org");
    expect(resolveOrganization).toHaveBeenCalledWith(user, "requested-org");
    expect(eq).toHaveBeenCalledWith("organization_id", "owned-org");
    expect(result).toMatchObject({ ok: true, plan: { key: "business" }, hasSubscription: true });
  });
  it("does not query subscription records without authorization", async () => {
    resolveOrganization.mockResolvedValue({ ok: false, code: "billing_admin_required" });
    expect(await loadBillingSummary(user)).toEqual({ ok: false, code: "billing_admin_required" });
    expect(from).not.toHaveBeenCalled();
  });
  it.each(["unpaid", "incomplete", "paused", "canceled"])("shows Free access for %s", async (status) => {
    single.mockResolvedValue({ data: { ...row, status }, error: null });
    expect(await loadBillingSummary(user)).toMatchObject({ ok: true, plan: { key: "free" }, hasSubscription: status !== "canceled" });
  });
  it("retains the paid plan during past-due grace", async () => {
    single.mockResolvedValue({ data: { ...row, status: "past_due" }, error: null });
    expect(await loadBillingSummary(user)).toMatchObject({ ok: true, plan: { key: "business" } });
  });
  it("uses Free only for a successful empty read", async () => {
    single.mockResolvedValue({ data: null, error: null });
    expect(await loadBillingSummary(user)).toMatchObject({ ok: true, plan: { key: "free" }, hasSubscription: false });
    single.mockResolvedValue({ data: null, error: { message: "private error" } });
    expect(await loadBillingSummary(user)).toEqual({ ok: false, code: "billing_storage_unavailable" });
  });
  it("rejects an unknown subscription shape", async () => {
    single.mockResolvedValue({ data: { ...row, status: "unexpected" }, error: null });
    expect(await loadBillingSummary(user)).toEqual({ ok: false, code: "billing_storage_unavailable" });
  });
});
