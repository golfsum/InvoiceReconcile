"use client";

import { useState } from "react";
import { CreditCard, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";
import type { PlanKey } from "@/lib/config";

const checkoutErrorMessages = {
  existing_subscription: "A subscription already exists. Use Manage subscription to make changes.",
  checkout_creation_in_progress: "Checkout is being prepared in another tab. Retry in about two minutes.",
  checkout_already_pending: "An open checkout exists for another plan. Reopen that plan, or wait up to 31 minutes before switching plans.",
} as const;

function checkoutErrorMessage(response: Response, result: { error?: unknown; code?: unknown }) {
  if (response.status === 401 && result.error === "Authentication required") {
    return "Sign in before choosing a paid plan.";
  }
  if (typeof result.code === "string" && result.code in checkoutErrorMessages) {
    return checkoutErrorMessages[result.code as keyof typeof checkoutErrorMessages];
  }
  return "Checkout is temporarily unavailable. Try again shortly.";
}

export function CheckoutButton({
  plan,
  label,
  organizationId,
}: {
  plan: Exclude<PlanKey, "free">;
  label: string;
  organizationId?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function beginCheckout() {
    setLoading(true);
    sendAnalyticsEvent("checkout_started", { plan, cta: "in_app" });
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, organizationId, returnTo: "/settings/billing" }),
      });
      const result = await response.json() as { url?: string; error?: unknown; code?: unknown };
      if (!response.ok || !result.url) throw new Error(checkoutErrorMessage(response, result));
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout could not be started.");
      setLoading(false);
    }
  }

  return <Button className="w-full" onClick={() => void beginCheckout()} disabled={loading}>{loading ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}{loading ? "Opening checkout" : label}</Button>;
}

export function PortalButton({ organizationId }: { organizationId?: string }) {
  const [loading, setLoading] = useState(false);
  async function openPortal() {
    setLoading(true);
    try {
      const returnTo = organizationId ? `/settings/billing?organizationId=${encodeURIComponent(organizationId)}` : "/settings/billing";
      const response = await fetch("/api/billing/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, returnTo }) });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error("No managed billing account is available yet.");
      window.location.assign(result.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The billing portal could not be opened.");
      setLoading(false);
    }
  }
  return <Button variant="secondary" onClick={() => void openPortal()} disabled={loading}>{loading ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}{loading ? "Opening portal" : "Manage subscription"}</Button>;
}
