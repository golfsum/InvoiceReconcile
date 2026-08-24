"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { AnalyticsEventName } from "@/lib/analytics";
import {
  ANALYTICS_SESSION_KEY,
  ANALYTICS_VISITOR_KEY,
  analyticsConsentGranted,
  readAnalyticsAttribution,
} from "@/lib/analytics/client";
import { analyticsPathTemplate } from "@/lib/analytics/paths";

type SafeProperties = Record<string, string>;
function browserId(storage: Storage, key: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  storage.setItem(key, value);
  return value;
}

function privacySafeReferrer() {
  if (!document.referrer) return undefined;
  try {
    const referrer = new URL(document.referrer);
    return `${referrer.protocol}//${referrer.host}/`;
  } catch {
    return undefined;
  }
}

export function sendAnalyticsEvent(eventName: AnalyticsEventName, properties: SafeProperties = {}) {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_FIRST_PARTY_ANALYTICS_ENABLED === "false" || !analyticsConsentGranted()) return;
  const attribution = readAnalyticsAttribution();
  const payload = {
    eventId: crypto.randomUUID(),
    eventName,
    anonymousId: browserId(window.localStorage, ANALYTICS_VISITOR_KEY),
    sessionId: browserId(window.sessionStorage, ANALYTICS_SESSION_KEY),
    path: analyticsPathTemplate(window.location.pathname),
    referrer: privacySafeReferrer(),
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    properties,
  };
  void fetch("/api/analytics/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive: true });
}

export function AnalyticsProvider() {
  const pathname = usePathname();
  useEffect(() => {
    sendAnalyticsEvent("page_view");
    if (pathname === "/pricing") sendAnalyticsEvent("pricing_viewed");
  }, [pathname]);
  return null;
}
