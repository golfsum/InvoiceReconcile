import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("service route degraded states", () => {
  it("accepts a validated contact request in explicit local demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    const { POST } = await import("@/app/api/contact/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/contact", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://invoicereconcile.com",
      },
      body: JSON.stringify({
        name: "Casey Morgan",
        email: "casey@example.com",
        subject: "Combined payment import",
        message: "Can I preserve allocation notes when I export the reconciliation?",
        sourcePath: "/contact",
        companyWebsite: "",
      }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.reference).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("labels analytics acceptance as demo when storage is not configured locally", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const { POST } = await import("@/app/api/analytics/events/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://invoicereconcile.com",
      },
      body: JSON.stringify({
        eventId: "4e6b80c6-6fc2-4d9f-936f-51aecbb68c4c",
        eventName: "sample_demo_started",
        anonymousId: "0d633d45-9cc4-447b-9da1-7039d99173a6",
        sessionId: "b8bdd221-e28f-430a-9d32-b56f2141ecb9",
        path: "/",
        properties: { demo_scenario: "combined_payment", source: "sample" },
      }),
    }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, mode: "demo" });
  });

  it("rejects a cross-site checkout request before reading billing data", async () => {
    const { POST } = await import("@/app/api/billing/checkout/route");
    const response = await POST(new Request("https://invoicereconcile.com/api/billing/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://malicious.example",
      },
      body: JSON.stringify({ plan: "solo" }),
    }));
    expect(response.status).toBe(403);
  });
});
