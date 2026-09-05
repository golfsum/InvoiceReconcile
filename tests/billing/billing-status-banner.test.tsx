import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSummary = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/summary", () => ({ loadBillingSummary: loadSummary }));
const freeSummary = {
  ok: true, organizationId: "10000000-0000-4000-8000-000000000001",
  plan: { key: "free", name: "Free", paymentLimit: 20 }, status: "active",
  hasBillingAccount: false, hasSubscription: false, cancelAtPeriodEnd: false, periodEndsAt: null,
};
beforeEach(() => loadSummary.mockResolvedValue(freeSummary));

vi.mock("@/lib/auth/access", () => ({
  requireUser: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
}));
vi.mock("@/lib/billing/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/catalog")>("@/lib/billing/catalog");
  return { ...actual, isBillingConfigured: vi.fn(() => true) };
});
vi.mock("@/components/billing/billing-actions", () => ({
  CheckoutButton: () => <button>Checkout</button>,
  PortalButton: () => <button>Portal</button>,
}));

describe("Billing checkout status", () => {
  it("shows confirmation without consuming or exposing a Stripe session identifier", async () => {
    const { default: BillingSettingsPage } = await import("@/app/settings/billing/page");
    render(await BillingSettingsPage({ searchParams: Promise.resolve({
      checkout: "success",
      session_id: "cs_live_must_not_be_rendered",
    }) }));

    expect(screen.getByRole("status")).toHaveTextContent(/if it is still pending, refresh/i);
    expect(screen.queryByText(/cs_live_must_not_be_rendered/)).not.toBeInTheDocument();
  });

  it("confirms a persisted paid plan and prevents duplicate checkout buttons", async () => {
    loadSummary.mockResolvedValue({ ...freeSummary, plan: { key: "business", name: "Business", paymentLimit: 2500 }, hasSubscription: true, hasBillingAccount: true });
    const { default: Page } = await import("@/app/settings/billing/page");
    render(await Page({ searchParams: Promise.resolve({ checkout: "success", plan: "business" }) }));
    expect(screen.getByRole("status")).toHaveTextContent("Your Business subscription is confirmed");
    expect(screen.getByRole("heading", { name: "Current plan: Business" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Portal" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Checkout" })).not.toBeInTheDocument();
  });

  it("does not report Free or allow checkout when billing cannot be verified", async () => {
    loadSummary.mockResolvedValue({ ok: false, code: "billing_storage_unavailable" });
    const { default: Page } = await import("@/app/settings/billing/page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Billing status could not be loaded/)).toBeVisible();
    expect(screen.queryByText("Current plan: Free")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Checkout" })).not.toBeInTheDocument();
  });

  it("shows payment recovery and scheduled cancellation from saved state", async () => {
    loadSummary.mockResolvedValue({ ...freeSummary, status: "past_due", hasSubscription: true, hasBillingAccount: true, cancelAtPeriodEnd: true, periodEndsAt: "2026-10-04T00:00:00Z" });
    const { default: Page } = await import("@/app/settings/billing/page");
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/Payment needs attention/)).toBeVisible();
    expect(screen.getByText(/Cancellation scheduled.*Oct 4, 2026/)).toBeVisible();
  });

  it("explains safe same-plan recovery after cancellation", async () => {
    const { default: BillingSettingsPage } = await import("@/app/settings/billing/page");
    render(await BillingSettingsPage({ searchParams: Promise.resolve({ checkout: "canceled" }) }));

    expect(screen.getByRole("status")).toHaveTextContent(/same plan reopens its secure session/i);
  });
});
