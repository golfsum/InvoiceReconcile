import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckoutButton } from "@/components/billing/billing-actions";

const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/components/analytics/analytics-provider", () => ({ sendAnalyticsEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CheckoutButton", () => {
  it("maps a pending intent code to a safe recovery action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "untrusted server detail",
      code: "checkout_already_pending",
    }), { status: 409, headers: { "content-type": "application/json" } })));

    render(<CheckoutButton plan="solo" label="Choose Solo" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Solo" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/Reopen that plan.*31 minutes/i),
    ));
  });

  it("does not surface an unrecognized server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "database host and internal exception",
      code: "unexpected_internal_code",
    }), { status: 503, headers: { "content-type": "application/json" } })));

    render(<CheckoutButton plan="business" label="Choose Business" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Business" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      "Checkout is temporarily unavailable. Try again shortly.",
    ));
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining("database host"));
  });
});
