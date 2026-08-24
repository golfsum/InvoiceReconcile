import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const requireUser = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/access", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));

const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";
const workspaceId = "11000000-0000-4000-8000-000000000001";

function workspaceForm(overrides: Record<string, string> = {}) {
  const values = {
    organizationId,
    workspaceId,
    businessName: "Morgan Books",
    currency: "USD",
    timezone: "America/Phoenix",
    accountingBasis: "accrual",
    matchDaysAfter: "90",
    ...overrides,
  };
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => form.set(key, value));
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  redirect.mockImplementation((destination: string) => {
    throw new Error(`redirect:${destination}`);
  });
});

describe("workspace lifecycle actions", () => {
  it("validates timezone input before calling the creation RPC", async () => {
    const rpc = vi.fn();
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { createAdditionalWorkspaceAction } = await import("@/app/app/workspaces/actions");

    await expect(createAdditionalWorkspaceAction({}, workspaceForm({ timezone: "not/a-zone" })))
      .resolves.toEqual({ error: "Choose a valid timezone." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a workspace through the capacity-enforcing RPC and refreshes the app layout", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: workspaceId, error: null });
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { createAdditionalWorkspaceAction } = await import("@/app/app/workspaces/actions");

    await expect(createAdditionalWorkspaceAction({}, workspaceForm({ currency: "JPY", timezone: "UTC" })))
      .rejects.toThrow(`redirect:/app/${workspaceId}/imports`);
    expect(rpc).toHaveBeenCalledWith("create_additional_workspace", expect.objectContaining({
      p_organization_id: organizationId,
      p_currency_code: "JPY",
      p_timezone: "UTC",
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/app", "layout");
  });

  it("returns a useful plan-cap message without redirecting", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "The Solo plan supports 1 active workspace" },
    });
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { createAdditionalWorkspaceAction } = await import("@/app/app/workspaces/actions");

    await expect(createAdditionalWorkspaceAction({}, workspaceForm())).resolves.toEqual({
      error: "The Solo plan supports 1 active workspace. Upgrade the organization plan or remove an unused workspace.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refreshes the workspace layout after saving settings", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { updateWorkspaceSettingsAction } = await import("@/app/app/workspaces/actions");

    await expect(updateWorkspaceSettingsAction({}, workspaceForm())).resolves.toEqual({ success: "Workspace settings saved." });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/${workspaceId}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/app/workspaces");
  });

  it("lets the authenticated user opt out of import emails without disabling in-app status", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "user-1" }, error: null });
    const profileQuery = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle,
    };
    profileQuery.update.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    profileQuery.select.mockReturnValue(profileQuery);
    const from = vi.fn().mockReturnValue(profileQuery);
    getSupabaseServerClient.mockResolvedValue({ from });
    const { updateImportEmailPreferenceAction } = await import("@/app/app/workspaces/actions");
    const form = workspaceForm({ enabled: "false" });

    await expect(updateImportEmailPreferenceAction({}, form)).resolves.toEqual({ success: "Import status emails disabled." });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(profileQuery.update).toHaveBeenCalledWith({ transactional_import_emails: false });
    expect(profileQuery.eq).toHaveBeenCalledWith("id", "user-1");
    expect(revalidatePath).toHaveBeenCalledWith(`/app/${workspaceId}/settings`);
  });

  it("returns to the organization portfolio after a successful deletion", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { deleted: true }, error: null });
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { deleteWorkspaceAction } = await import("@/app/app/workspaces/actions");

    await expect(deleteWorkspaceAction({}, workspaceForm({ confirmation: "DELETE" })))
      .rejects.toThrow("redirect:/app/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/app", "layout");
  });

  it("keeps an empty organization in the workspace creation flow", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { remaining_workspaces: 0 }, error: null });
    getSupabaseServerClient.mockResolvedValue({ rpc });
    const { deleteWorkspaceAction } = await import("@/app/app/workspaces/actions");

    await expect(deleteWorkspaceAction({}, workspaceForm({ confirmation: "DELETE" })))
      .rejects.toThrow("redirect:/app/workspaces");
  });
});
