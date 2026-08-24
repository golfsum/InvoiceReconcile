"use client";

import { track } from "@vercel/analytics";

export const ANALYTICS_CONSENT_KEY = "ir_analytics_consent_v1";
export const ANALYTICS_VISITOR_KEY = "ir_analytics_visitor_v1";
export const ANALYTICS_SESSION_KEY = "ir_analytics_session_v1";
export const ANALYTICS_ATTRIBUTION_KEY = "ir_analytics_attribution_v1";

export type AnalyticsAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  signupSource: string;
};

const CAMPAIGN_VALUE = /^[A-Za-z0-9._~-]{1,100}$/;

function campaignValue(value: string | null) {
  const normalized = value?.trim();
  return normalized && CAMPAIGN_VALUE.test(normalized) ? normalized : undefined;
}

export function analyticsConsentGranted() {
  return typeof window !== "undefined" && window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "accepted";
}

export function readAnalyticsAttribution(): AnalyticsAttribution {
  if (!analyticsConsentGranted()) return { signupSource: "unattributed" };

  const current = {
    utmSource: campaignValue(new URLSearchParams(window.location.search).get("utm_source")),
    utmMedium: campaignValue(new URLSearchParams(window.location.search).get("utm_medium")),
    utmCampaign: campaignValue(new URLSearchParams(window.location.search).get("utm_campaign")),
  };
  if (current.utmSource || current.utmMedium || current.utmCampaign) {
    window.localStorage.setItem(ANALYTICS_ATTRIBUTION_KEY, JSON.stringify(current));
  }

  let stored: typeof current = current;
  if (!current.utmSource && !current.utmMedium && !current.utmCampaign) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ANALYTICS_ATTRIBUTION_KEY) || "{}") as Record<string, unknown>;
      stored = {
        utmSource: campaignValue(typeof parsed.utmSource === "string" ? parsed.utmSource : null),
        utmMedium: campaignValue(typeof parsed.utmMedium === "string" ? parsed.utmMedium : null),
        utmCampaign: campaignValue(typeof parsed.utmCampaign === "string" ? parsed.utmCampaign : null),
      };
    } catch {
      window.localStorage.removeItem(ANALYTICS_ATTRIBUTION_KEY);
    }
  }

  let signupSource = stored.utmSource || "direct";
  if (!stored.utmSource && document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) signupSource = "referral";
    } catch {
      // An invalid referrer is treated as unattributed direct traffic.
    }
  }
  return { ...stored, signupSource };
}

function analyticsCookieDomains() {
  const hostname = window.location.hostname.toLowerCase();
  const domains = new Set([hostname]);
  if (hostname.endsWith(".invoicereconcile.com")) domains.add("invoicereconcile.com");
  return [...domains];
}

function expireGoogleAnalyticsCookies() {
  const names = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  for (const name of names) {
    const expired = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`;
    document.cookie = expired;
    for (const domain of analyticsCookieDomains()) {
      document.cookie = `${expired}; Domain=${domain}`;
    }
  }
}

export function setGoogleAnalyticsDisabled(gaId: string | undefined, disabled: boolean) {
  if (typeof window === "undefined" || !gaId) return;
  Object.assign(window, { [`ga-disable-${gaId}`]: disabled });
}

export function clearAnalyticsStorage(gaId?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ANALYTICS_VISITOR_KEY);
  window.localStorage.removeItem(ANALYTICS_ATTRIBUTION_KEY);
  window.sessionStorage.removeItem(ANALYTICS_SESSION_KEY);
  setGoogleAnalyticsDisabled(gaId, true);
  expireGoogleAnalyticsCookies();
}

export function withdrawAnalyticsConsent(gaId?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "rejected");
  clearAnalyticsStorage(gaId);
}

export function sendVercelAnalyticsEvent(
  eventName: string,
  properties: Record<string, string | number | boolean | null> = {},
) {
  if (!analyticsConsentGranted()) return;
  try {
    track(eventName, properties);
  } catch {
    // Analytics must never interrupt a product workflow.
  }
}
