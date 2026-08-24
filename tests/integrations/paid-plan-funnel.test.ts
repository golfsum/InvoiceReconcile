import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const requireUser = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const getSupabaseServiceClient = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/access", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));

function signupForm(plan: string) {
  const form = new FormData();
  form.set("email", "owner@example.com");
  form.set("password", "long-password");
  form.set("fullName", "Casey Morgan");
  form.set("businessName", "Morgan Books");
  form.set("signupSource", "direct");
  form.set("plan", plan);
  return form;
}

function onboardingForm(plan: string) {
  const form = new FormData();
  form.set("businessName", "Morgan Books");
  form.set("organizationType", "bookkeeping_firm");
  form.set("currency", "USD");
  form.set("timezone", "America/Phoenix");
  form.set("accountingBasis", "accrual");
  form.set("matchDaysAfter", "60");
  form.set("selectedPlan", plan);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  redirect.mockImplementation((destination: string) => {
    throw new Error(`redirect:${destination}`);
  });
  requireUser.mockResolvedValue({ id: "user-1" });
  getSupabaseServiceClient.mockReturnValue(null);
});

describe("paid plan signup handoff", () => {
  it("stores and carries an allowlisted plan through email verification", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: {}, user: null }, error: null });
    getSupabaseServerClient.mockResolvedValue({ auth: { signUp } });
    const { signUpAction } = await import("@/app/auth/actions");

    await expect(signUpAction({}, signupForm("business"))).rejects.toThrow(
      "redirect:/onboarding?plan=business",
    );
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        emailRedirectTo: expect.stringContaining("next=%2Fonboarding%3Fplan%3Dbusiness"),
        data: expect.objectContaining({ selected_plan: "business" }),
      }),
    }));
  });

  it("rejects a tampered plan before creating an account", async () => {
    const signUp = vi.fn();
    getSupabaseServerClient.mockResolvedValue({ auth: { signUp } });
    const { signUpAction } = await import("@/app/auth/actions");

    await expect(signUpAction({}, signupForm("enterprise"))).resolves.toMatchObject({ error: expect.any(String) });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("carries an invitation return path through email verification", async () => {
    const form = signupForm("");
    form.delete("plan");
    form.set("signupSource", "referral");
    form.set("returnTo", "/auth/accept-invite");
    const signUp = vi.fn().mockResolvedValue({ data: { session: {}, user: null }, error: null });
    getSupabaseServerClient.mockResolvedValue({ auth: { signUp } });
    const { signUpAction } = await import("@/app/auth/actions");

    await expect(signUpAction({}, form)).rejects.toThrow("redirect:/auth/accept-invite");
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        emailRedirectTo: expect.stringContaining("next=%2Fauth%2Faccept-invite"),
        data: expect.objectContaining({ signup_source: "referral" }),
      }),
    }));
  });

  it("routes a new workspace to the selected organization checkout flow", async () => {
    const organizationId = "e73c62fe-7cc0-4dd6-a9ce-123853a9e5e0";
    const workspaceId = "11000000-0000-4000-8000-000000000001";
    const rpc = vi.fn().mockResolvedValue({ data: [{ organization_id: organizationId, workspace_id: workspaceId }], error: null });
    const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
    getSupabaseServerClient.mockResolvedValue({ rpc, auth: { updateUser } });
    const { createWorkspaceAction } = await import("@/app/onboarding/actions");

    await expect(createWorkspaceAction({}, onboardingForm("solo"))).rejects.toThrow(
      `redirect:/settings/billing?plan=solo&organizationId=${organizationId}&onboarding=complete`,
    );
    expect(updateUser).toHaveBeenCalledWith({ data: { selected_plan: null } });
    expect(rpc).toHaveBeenCalledWith("create_initial_workspace", expect.objectContaining({
      p_match_days_after: 60,
    }));
  });
});
