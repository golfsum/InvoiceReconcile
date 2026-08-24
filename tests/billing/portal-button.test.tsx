import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalButton } from "@/components/billing/billing-actions";

vi.mock("@/components/analytics/analytics-provider", () => ({ sendAnalyticsEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PortalButton", () => {
  it("binds the portal request and return URL to the selected organization", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => new Promise<Response>(() => undefined),
    );
    vi.stubGlobal("fetch", fetchMock);
    const organizationId = "10000000-0000-4000-8000-000000000001";

    render(<PortalButton organizationId={organizationId} />);
    fireEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      organizationId,
      returnTo: `/settings/billing?organizationId=${organizationId}`,
    });
  });
});
