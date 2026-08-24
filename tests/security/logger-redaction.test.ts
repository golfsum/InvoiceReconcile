import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("server log redaction", () => {
  it("keeps only approved metadata and redacts unsafe values", async () => {
    const { sanitizeLogContext } = await import("@/lib/logger");
    expect(sanitizeLogContext({
      operation: "reconciliation_run",
      code: "PGRST116",
      requestId: "98c5134a-20e7-49d7-a4ce-6919a137dd20",
      eventType: "checkout.session.completed",
      message: "Customer Jane Doe jane@example.test uploaded C:\\Clients\\Acme.csv",
      email: "jane@example.test",
      plan: "business",
    })).toEqual({
      operation: "reconciliation_run",
      code: "PGRST116",
      requestId: "98c5134a-20e7-49d7-a4ce-6919a137dd20",
      eventType: "checkout.session.completed",
      plan: "business",
    });
  });

  it("redacts an approved field when its value is not a safe identifier", async () => {
    const { sanitizeLogContext } = await import("@/lib/logger");
    expect(sanitizeLogContext({ code: "invoice for jane@example.test" })).toEqual({ code: "[redacted]" });
  });
});
