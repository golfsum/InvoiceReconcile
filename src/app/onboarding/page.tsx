import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand/logo";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { requireUser } from "@/lib/auth/access";
import {
  onboardingPathForPlan,
  selectedPaidPlan,
  selectedPaidPlanFromMetadata,
} from "@/lib/billing/intent";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create a workspace", robots: { index: false, follow: false } };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const queryPlan = selectedPaidPlan((await searchParams).plan);
  await requireUser(onboardingPathForPlan(queryPlan));
  const supabase = await getSupabaseServerClient();
  const { data: authData } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const selectedPlan = queryPlan || selectedPaidPlanFromMetadata(authData.user?.user_metadata);
  return <main className="min-h-screen bg-background"><div className="page-shell py-8"><BrandLogo /></div><div className="page-shell grid gap-12 pb-16 pt-8 lg:grid-cols-[0.72fr_1.28fr]"><div><p className="eyebrow">Step 1 of 3</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Set the matching defaults once.</h1><p className="mt-4 text-base leading-7 text-muted-strong">These settings keep date, currency, and client context explicit. You can change them later without changing source records.</p></div><section className="border bg-surface p-6 sm:p-8"><h2 className="text-xl font-semibold">Create your first workspace</h2><p className="mt-2 text-sm leading-6 text-muted">No accounting connection or payment card is required.</p><OnboardingForm selectedPlan={selectedPlan || undefined} /></section></div></main>;
}
