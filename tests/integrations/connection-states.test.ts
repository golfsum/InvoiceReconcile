import { describe, expect, it } from "vitest";
import { connectionStates } from "@/lib/integrations";

describe("integration connection states", () => {
  it("never reports an unconfigured provider as connected", () => {
    const connections = connectionStates([], { NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(connections).toHaveLength(5);
    expect(connections.every((connection) => connection.status === "disconnected")).toBe(true);
    expect(connections.every((connection) => connection.configured === false)).toBe(true);
    expect(connections.every((connection) => connection.connectionFlow === "not_configured")).toBe(true);
  });

  it("reports database state separately from credential readiness", () => {
    const connections = connectionStates([
      {
        provider: "quickbooks",
        status: "degraded",
        connected_at: "2026-08-01T10:00:00.000Z",
        last_error_code: "oauth_refresh_failed",
      },
    ], {
      NODE_ENV: "test",
      QUICKBOOKS_CLIENT_ID: "configured",
      QUICKBOOKS_CLIENT_SECRET: "configured",
    } as NodeJS.ProcessEnv);
    const quickbooks = connections.find((connection) => connection.provider === "quickbooks");
    expect(quickbooks).toMatchObject({
      configured: true,
      connectionFlow: "not_implemented",
      status: "degraded",
      lastErrorCode: "oauth_refresh_failed",
    });
    expect(connections.find((connection) => connection.provider === "xero")?.status).toBe("disconnected");
  });
});
