import { describe, expect, it } from "vitest";
import { isLikelyAutomatedUserAgent } from "@/lib/analytics";

describe("analytics bot filtering", () => {
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 HeadlessChrome/128.0",
    "facebookexternalhit/1.1",
  ])("recognizes automated user agents", (value) => {
    expect(isLikelyAutomatedUserAgent(value)).toBe(true);
  });

  it("allows an ordinary browser user agent", () => {
    expect(isLikelyAutomatedUserAgent("Mozilla/5.0 Chrome/128.0 Safari/537.36")).toBe(false);
    expect(isLikelyAutomatedUserAgent(null)).toBe(false);
  });
});
