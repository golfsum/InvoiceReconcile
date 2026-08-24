import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { privacySafeVercelEvent } from "@/components/analytics/consent-analytics";
import { analyticsPathTemplate, isPublicAnalyticsPath } from "@/lib/analytics/paths";

describe("analytics path privacy", () => {
  it("uses an explicit marketing allowlist for third-party pageviews", () => {
    expect(isPublicAnalyticsPath("/pricing")).toBe(true);
    expect(isPublicAnalyticsPath("/resources/reconciling-partial-payments")).toBe(true);
    expect(isPublicAnalyticsPath("/app/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/imports")).toBe(false);
    expect(isPublicAnalyticsPath("/admin")).toBe(false);
    expect(isPublicAnalyticsPath("/settings/billing")).toBe(false);
    expect(isPublicAnalyticsPath("/auth/sign-in")).toBe(false);
  });

  it("templates UUID-bearing routes and removes query strings", () => {
    expect(analyticsPathTemplate(
      "/app/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/exceptions?invoice=private",
    )).toBe("/app/:workspaceId/exceptions");
    expect(analyticsPathTemplate(
      "/api/organizations/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/invitations",
    )).toBe("/api/organizations/:organizationId/invitations");
  });

  it("drops private Vercel pageviews but retains templated safe product events", () => {
    const url = "https://invoicereconcile.com/app/e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0/imports?source=private";
    expect(privacySafeVercelEvent({ type: "pageview", url })).toBeNull();
    expect(privacySafeVercelEvent({ type: "event", url })).toEqual({
      type: "event",
      url: "https://invoicereconcile.com/app/:workspaceId/imports",
    });
  });

  it("normalizes the path before it enters first-party storage or rate-limit keys", () => {
    const route = readFileSync("src/app/api/analytics/events/route.ts", "utf8");
    expect(route).toContain("const safePath = parsed.data.path ? analyticsPathTemplate(parsed.data.path) : undefined");
    expect(route).toContain('`${parsed.data.anonymousId}:${parsed.data.eventName}:${safePath || "no-path"}`');
    expect(route).toContain("path: safePath");
  });
});
