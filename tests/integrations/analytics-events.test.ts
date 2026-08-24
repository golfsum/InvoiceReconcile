import { describe, expect, it } from "vitest";
import { analyticsEventSchema, referrerHost } from "@/lib/analytics";

const baseEvent = {
  eventId: "d775f971-5c13-47ba-9003-3dca5957617e",
  eventName: "reconciliation_completed",
  anonymousId: "9d1784cb-d5f9-4c0d-943a-45ab8d215e09",
  sessionId: "e64fd8a3-9176-4179-962a-ff2d1fc5de7b",
  path: "/app/demo/exceptions",
  properties: { match_method: "combined_payment", result: "confirmed" },
};

describe("privacy-safe analytics schema", () => {
  it("accepts the required product funnel events with bounded properties", () => {
    expect(analyticsEventSchema.safeParse(baseEvent).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...baseEvent, eventName: "sample_demo_started" }).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...baseEvent, eventName: "lump_sum_tool_used" }).success).toBe(true);
  });

  it("rejects financial, personal, and arbitrary properties", () => {
    expect(analyticsEventSchema.safeParse({
      ...baseEvent,
      properties: { amount: 4_725 },
    }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({
      ...baseEvent,
      properties: { email: "person@example.com" },
    }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({
      ...baseEvent,
      properties: { customer_name: "Northstar" },
    }).success).toBe(false);
  });

  it("keeps query strings out of stored paths and stores only referrer hosts", () => {
    expect(analyticsEventSchema.safeParse({ ...baseEvent, path: "/pricing?email=person@example.com" }).success).toBe(false);
    expect(referrerHost("https://Search.Example.com/results?q=sensitive")).toBe("search.example.com");
  });
});
