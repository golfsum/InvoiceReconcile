import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

    expect(screen.getByRole("status")).toHaveTextContent(/Stripe is confirming the subscription/i);
    expect(screen.queryByText(/cs_live_must_not_be_rendered/)).not.toBeInTheDocument();
  });

  it("explains safe same-plan recovery after cancellation", async () => {
    const { default: BillingSettingsPage } = await import("@/app/settings/billing/page");
    render(await BillingSettingsPage({ searchParams: Promise.resolve({ checkout: "canceled" }) }));

    expect(screen.getByRole("status")).toHaveTextContent(/same plan reopens its secure session/i);
  });
});
