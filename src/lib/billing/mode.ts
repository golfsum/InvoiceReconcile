export type StripeBillingMode = "test" | "live";

// Live billing requires deliberate opt-in. NODE_ENV is also "production" for
// preview builds, so use Vercel's deployment environment to protect previews.
export function stripeBillingMode(environment: NodeJS.ProcessEnv = process.env): StripeBillingMode | null {
  const mode = environment.STRIPE_BILLING_MODE?.trim() || "test";
  if (mode !== "test" && mode !== "live") return null;
  if (mode === "live" && environment.VERCEL_ENV && environment.VERCEL_ENV !== "production") return null;
  const secret = environment.STRIPE_SECRET_KEY?.trim() || "";
  const publishable = environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || "";
  return new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9]+$`).test(secret)
    && new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(publishable)
    ? mode : null;
}

export function stripeObjectMatchesMode(
  object: { livemode: boolean },
  environment: NodeJS.ProcessEnv = process.env,
) {
  const mode = stripeBillingMode(environment);
  return mode !== null && object.livemode === (mode === "live");
}
