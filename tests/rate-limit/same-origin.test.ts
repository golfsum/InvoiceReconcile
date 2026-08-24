import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let verifySameOrigin: typeof import("@/lib/rate-limit").verifySameOrigin;

beforeAll(async () => {
  ({ verifySameOrigin } = await import("@/lib/rate-limit"));
});

describe("verifySameOrigin", () => {
  it("uses the browser-facing host header in local development", () => {
    const request = new Request("http://localhost:3001/api/analytics/events", {
      headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" },
    });
    expect(verifySameOrigin(request)).toBe(true);
  });

  it("uses forwarded origin information behind a trusted application proxy", () => {
    const request = new Request("http://internal:3000/api/contact", {
      headers: {
        origin: "https://invoicereconcile.com",
        "x-forwarded-host": "invoicereconcile.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(verifySameOrigin(request)).toBe(true);
  });

  it("rejects a different origin", () => {
    const request = new Request("https://invoicereconcile.com/api/contact", {
      headers: { host: "invoicereconcile.com", origin: "https://attacker.example" },
    });
    expect(verifySameOrigin(request)).toBe(false);
  });
});
