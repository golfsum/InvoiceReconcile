import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const requireUser = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
const getSupabaseServiceClient = vi.hoisted(() => vi.fn());
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/access", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient }));
vi.mock("@/lib/supabase/service", () => ({ getSupabaseServiceClient }));
vi.mock("@/lib/logger", () => ({ logger: { warn: loggerWarn } }));

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
  it("explains an unconfirmed email and logs only safe rejection metadata", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { code: "email_not_confirmed", message: "Email not confirmed", status: 400 },
    });
    getSupabaseServerClient.mockResolvedValue({ auth: { signInWithPassword } });
    const { signInAction } = await import("@/app/auth/actions");
    const form = new FormData();
    form.set("email", "owner@example.com");
    form.set("password", "long-password");

    await expect(signInAction({}, form)).resolves.toEqual({
      error: "Confirm your email before signing in. Use “Send a new one” below if the first confirmation link did not work.",
    });
    expect(loggerWarn).toHaveBeenCalledWith({
      operation: "sign_in",
      code: "email_not_confirmed",
      status: 400,
    }, "Supabase auth request failed");
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("owner@example.com");
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("long-password");
  });

  it("keeps invalid credentials generic while recording the safe Supabase code", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 },
    });
    getSupabaseServerClient.mockResolvedValue({ auth: { signInWithPassword } });
    const { signInAction } = await import("@/app/auth/actions");
    const form = new FormData();
    form.set("email", "unknown@example.com");
    form.set("password", "long-password");

    await expect(signInAction({}, form)).resolves.toEqual({
      error: "We could not sign you in with those details. Check your email and password.",
    });
    expect(loggerWarn).toHaveBeenCalledWith({
      operation: "sign_in",
      code: "invalid_credentials",
      status: 400,
    }, "Supabase auth request failed");
  });

  it("reports an unreachable auth service instead of blaming the credentials", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 },
    });
    getSupabaseServerClient.mockResolvedValue({ auth: { signInWithPassword } });
    const { signInAction } = await import("@/app/auth/actions");
    const form = new FormData();
    form.set("email", "owner@example.com");
    form.set("password", "long-password");

    await expect(signInAction({}, form)).resolves.toEqual({
      error: "Sign-in is temporarily unavailable. Try again shortly or contact support.",
    });
    expect(loggerWarn).toHaveBeenCalledWith({
      operation: "sign_in",
      code: "AuthRetryableFetchError",
      status: 0,
    }, "Supabase auth request failed");
  });

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

  it("routes an email-confirmation signup to a dedicated success page", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: null, user: { id: "user-1" } }, error: null });
    getSupabaseServerClient.mockResolvedValue({ auth: { signUp } });
    const { signUpAction } = await import("@/app/auth/actions");

    await expect(signUpAction({}, signupForm("business"))).rejects.toThrow(
      "redirect:/auth/account-created?returnTo=%2Fonboarding%3Fplan%3Dbusiness&delivery=sent",
    );
  });

  it("treats a confirmation email rate limit as an account-created delivery delay", async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { session: null, user: { id: "user-1" } },
      error: { code: "over_email_send_rate_limit", message: "Email rate limit exceeded", status: 429 },
    });
    getSupabaseServerClient.mockResolvedValue({ auth: { signUp } });
    const { signUpAction } = await import("@/app/auth/actions");

    await expect(signUpAction({}, signupForm(""))).rejects.toThrow(
      "redirect:/auth/account-created?returnTo=%2Fonboarding&delivery=delayed",
    );
    expect(loggerWarn).toHaveBeenCalledWith({
      operation: "sign_up",
      code: "over_email_send_rate_limit",
      status: 429,
    }, "Supabase auth request failed");
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

  it("resends signup confirmation to the exact production callback without revealing account state", async () => {
    const resend = vi.fn().mockResolvedValue({ data: {}, error: new Error("Account is already confirmed") });
    getSupabaseServerClient.mockResolvedValue({ auth: { resend } });
    const { resendConfirmationAction } = await import("@/app/auth/actions");
    const form = new FormData();
    form.set("email", "owner@example.com");
    form.set("returnTo", "/onboarding?plan=business");

    await expect(resendConfirmationAction({}, form)).resolves.toEqual({
      message: "If that account still needs verification, a new confirmation email is on its way.",
    });
    expect(resend).toHaveBeenCalledWith({
      type: "signup",
      email: "owner@example.com",
      options: {
        emailRedirectTo: "https://invoicereconcile.com/auth/callback?next=%2Fonboarding%3Fplan%3Dbusiness",
      },
    });
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
