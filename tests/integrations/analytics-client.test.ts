import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import {
  ANALYTICS_ATTRIBUTION_KEY,
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_SESSION_KEY,
  ANALYTICS_VISITOR_KEY,
  clearAnalyticsStorage,
  withdrawAnalyticsConsent,
} from "@/lib/analytics/client";

describe("consented browser analytics identity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "accepted");
    window.history.replaceState({}, "", "/pricing?utm_source=google&utm_medium=cpc&utm_campaign=august_books");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  });

  it("keeps one visitor across sessions while rotating the tab session and sends bounded UTM fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    sendAnalyticsEvent("pricing_viewed");
    const visitorId = window.localStorage.getItem(ANALYTICS_VISITOR_KEY);
    const firstSessionId = window.sessionStorage.getItem(ANALYTICS_SESSION_KEY);
    const firstPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

    expect(visitorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstSessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstPayload).toMatchObject({
      anonymousId: visitorId,
      sessionId: firstSessionId,
      path: "/pricing",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "august_books",
    });

    window.sessionStorage.clear();
    sendAnalyticsEvent("page_view");
    const secondPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;

    expect(secondPayload.anonymousId).toBe(visitorId);
    expect(secondPayload.sessionId).not.toBe(firstSessionId);
  });

  it("does not create identifiers or send events without consent", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "rejected");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    sendAnalyticsEvent("page_view");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ANALYTICS_VISITOR_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
  });

  it("templates private identifiers before sending and minimizes the referrer to its origin", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/app/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/imports?source=private");
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://invoicereconcile.com/app/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/invoices?customer=private",
    });

    sendAnalyticsEvent("import_started", { import_type: "invoice" });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

    expect(payload.path).toBe("/app/:workspaceId/imports");
    expect(payload.referrer).toBe("https://invoicereconcile.com/");
    expect(JSON.stringify(payload)).not.toContain("e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0");
    expect(JSON.stringify(payload)).not.toContain("customer=private");
  });

  it("expires only known GA cookies when consent is withdrawn", () => {
    window.localStorage.setItem(ANALYTICS_VISITOR_KEY, crypto.randomUUID());
    window.localStorage.setItem(ANALYTICS_ATTRIBUTION_KEY, "{}");
    window.sessionStorage.setItem(ANALYTICS_SESSION_KEY, crypto.randomUUID());
    document.cookie = "_ga=GA1.1.123.456; Path=/";
    document.cookie = "_ga_TEST=GS1.1.123.1; Path=/";
    document.cookie = "sb-auth-token=necessary; Path=/";

    clearAnalyticsStorage("G-TEST1234");

    expect(document.cookie).not.toContain("_ga=");
    expect(document.cookie).not.toContain("_ga_TEST=");
    expect(document.cookie).toContain("sb-auth-token=necessary");
    expect(window.localStorage.getItem(ANALYTICS_VISITOR_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST1234"]).toBe(true);
  });

  it("revokes the stored opt-in before reopening privacy choices", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(ANALYTICS_VISITOR_KEY, crypto.randomUUID());

    withdrawAnalyticsConsent("G-TEST1234");
    sendAnalyticsEvent("page_view");

    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("rejected");
    expect(window.localStorage.getItem(ANALYTICS_VISITOR_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
