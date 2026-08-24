import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));

const workspaceId = "11000000-0000-4000-8000-000000000001";
const customerId = "11100000-0000-4000-8000-000000000001";
const ruleId = "11800000-0000-4000-8000-000000000001";

function request(method: "POST" | "PATCH" | "DELETE", body: unknown, origin = "https://invoicereconcile.com") {
  return new Request(`https://invoicereconcile.com/api/workspaces/${workspaceId}/rules`, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function client(rpc: ReturnType<typeof vi.fn>) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
    rpc,
  };
}

afterEach(async () => {
  getSupabaseServerClient.mockReset();
  const { __resetMemoryRateLimitsForTests } = await import("@/lib/rate-limit");
  __resetMemoryRateLimitsForTests();
  vi.resetModules();
});

describe("workspace payer rules route", () => {
  it("rejects cross-site writes before reading authentication state", async () => {
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await POST(
      request("POST", { alias: "Parent Treasury", customerId }, "https://attacker.example"),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(403);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("creates a tenant-scoped payer mapping through the audited RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        existing: false,
        rule: {
          id: ruleId,
          alias: "Parent Treasury",
          normalizedAlias: "PARENT TREASURY",
          customerId,
          customerName: "Acme Consulting LLC",
          matchType: "exact_normalized",
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      },
      error: null,
    });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await POST(
      request("POST", { alias: " Parent Treasury ", customerId }),
      { params: Promise.resolve({ workspaceId }) },
    );

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_workspace_payer_mapping", {
      p_workspace_id: workspaceId,
      p_alias: "Parent Treasury",
      p_customer_id: customerId,
    });
    await expect(response.json()).resolves.toMatchObject({ rule: { id: ruleId, customerId } });
  });

  it("returns a truthful forbidden state when the workspace role cannot edit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "Workspace editing access is required" } });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await POST(
      request("POST", { alias: "Parent Treasury", customerId }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("permission") });
  });

  it("deletes a mapping through the workspace-scoped audit RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ruleId, deleted: true, existing: false }, error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { DELETE } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await DELETE(
      request("DELETE", { ruleId }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_workspace_payer_mapping", {
      p_workspace_id: workspaceId,
      p_rule_id: ruleId,
    });
  });

  it("updates a mapping through the workspace-scoped audit RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        existing: false,
        rule: {
          id: ruleId,
          alias: "Updated Treasury",
          normalizedAlias: "UPDATED TREASURY",
          customerId,
          customerName: "Acme Consulting LLC",
          matchType: "exact_normalized",
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      },
      error: null,
    });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { PATCH } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await PATCH(
      request("PATCH", { ruleId, alias: " Updated Treasury ", customerId }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_workspace_payer_mapping", {
      p_workspace_id: workspaceId,
      p_rule_id: ruleId,
      p_alias: "Updated Treasury",
      p_customer_id: customerId,
    });
    await expect(response.json()).resolves.toMatchObject({ rule: { id: ruleId, alias: "Updated Treasury" } });
  });

  it("creates a bounded reference template through the custom-rule RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        existing: false,
        rule: {
          id: ruleId,
          kind: "reference_template",
          sourcePattern: "NS-2026-{digits}",
          normalizedPattern: "NS-2026-{DIGITS}",
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      },
      error: null,
    });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await POST(
      request("POST", { type: "reference_template", pattern: "NS-2026-{digits}" }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("create_workspace_custom_matching_rule", {
      p_workspace_id: workspaceId,
      p_rule_type: "reference_pattern",
      p_source_pattern: "NS-2026-{digits}",
      p_customer_id: null,
      p_maximum_fee_minor: null,
      p_maximum_fee_basis_points: null,
    });
  });

  it("rejects raw regex, repeated tokens, and non-ASCII templates before any custom-rule RPC executes", async () => {
    const rpc = vi.fn();
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    for (const pattern of ["NS-2026-[0-9]+", "NS-{digits}-{digits}", "Café-{digits}"]) {
      const response = await POST(
        request("POST", { type: "reference_template", pattern }),
        { params: Promise.resolve({ workspaceId }) },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("{digits}") });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a structured upgrade state when the custom-rule plan gate denies a write", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Custom matching rules require a Business or Bookkeeper plan" },
    });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { POST } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await POST(
      request("POST", { type: "description_customer", pattern: "Parent remittance", customerId }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ upgradeRequired: true, upgradeUrl: "/settings/billing" });
  });

  it("deletes a custom rule through the same tenant-scoped route", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ruleId, deleted: true, existing: false }, error: null });
    getSupabaseServerClient.mockResolvedValue(client(rpc));
    const { DELETE } = await import("@/app/api/workspaces/[workspaceId]/rules/route");
    const response = await DELETE(
      request("DELETE", { ruleId, ruleType: "accepted_fee_behavior" }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_workspace_custom_matching_rule", {
      p_workspace_id: workspaceId,
      p_rule_id: ruleId,
    });
  });
});
