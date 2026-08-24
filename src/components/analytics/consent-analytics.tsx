"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import {
  ANALYTICS_CONSENT_KEY,
  setGoogleAnalyticsDisabled,
  withdrawAnalyticsConsent,
} from "@/lib/analytics/client";
import { analyticsPathTemplate, isPublicAnalyticsPath } from "@/lib/analytics/paths";

type AnalyticsChoice = "accepted" | "rejected" | "unset";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    __irGaLastPagePath?: string;
  }
}

function analyticsUrl(value: string, pathname: string) {
  try {
    const url = new URL(value, "https://invoicereconcile.com");
    url.pathname = analyticsPathTemplate(pathname);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `https://invoicereconcile.com${analyticsPathTemplate(pathname)}`;
  }
}

export function privacySafeVercelEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  let pathname: string;
  try {
    pathname = new URL(event.url, "https://invoicereconcile.com").pathname;
  } catch {
    return null;
  }
  if (event.type === "pageview" && !isPublicAnalyticsPath(pathname)) return null;
  return { ...event, url: analyticsUrl(event.url, pathname) };
}

function blockLoadedVercelAnalytics() {
  window.va?.("beforeSend", () => null);
}

function jsonForInlineScript(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function PrivacySafeGoogleAnalytics({
  gaId,
  pathname,
  publicRoute,
}: {
  gaId: string;
  pathname: string;
  publicRoute: boolean;
}) {
  useEffect(() => {
    setGoogleAnalyticsDisabled(gaId, !publicRoute);
    window.gtag?.("consent", "update", {
      analytics_storage: publicRoute ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    if (publicRoute && window.gtag && window.__irGaLastPagePath !== pathname) {
      window.__irGaLastPagePath = pathname;
      window.gtag("event", "page_view", {
        page_path: pathname,
        page_location: `${window.location.origin}${pathname}`,
        page_title: document.title,
      });
    }
    return () => {
      setGoogleAnalyticsDisabled(gaId, true);
      window.gtag?.("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    };
  }, [gaId, pathname, publicRoute]);

  if (!publicRoute) return null;
  const safeGaId = jsonForInlineScript(gaId);
  const safePath = jsonForInlineScript(pathname);
  return (
    <>
      <Script
        id="ir-ga-consent-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
          window['ga-disable-' + ${safeGaId}] = false;
          window.gtag('consent', 'default', {
            analytics_storage: 'granted',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            wait_for_update: 500
          });
          window.gtag('js', new Date());
          window.gtag('config', ${safeGaId}, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false
          });
          if (window.__irGaLastPagePath !== ${safePath}) {
            window.__irGaLastPagePath = ${safePath};
            window.gtag('event', 'page_view', {
              page_path: ${safePath},
              page_location: window.location.origin + ${safePath},
              page_title: document.title
            });
          }
        ` }}
      />
      <Script
        id="ir-ga-library"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
      />
    </>
  );
}

export function ConsentAnalytics({
  firstPartyEnabled,
  gaId,
  vercelEnabled,
}: {
  firstPartyEnabled: boolean;
  gaId?: string;
  vercelEnabled: boolean;
}) {
  const pathname = usePathname();
  const publicRoute = isPublicAnalyticsPath(pathname);
  const [hydrated, setHydrated] = useState(false);
  const [choice, setChoice] = useState<AnalyticsChoice>("unset");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      setChoice(saved === "accepted" || saved === "rejected" ? saved : "unset");
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function saveChoice(next: Exclude<AnalyticsChoice, "unset">) {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next);
    if (next === "rejected") {
      withdrawAnalyticsConsent(gaId);
      blockLoadedVercelAnalytics();
    } else {
      setGoogleAnalyticsDisabled(gaId, !publicRoute);
    }
    setChoice(next);
  }

  function reopenChoices() {
    // Opening the consent controls is itself a withdrawal until the person
    // explicitly opts back in. This closes the window where product events
    // could still read a previously accepted value from localStorage.
    withdrawAnalyticsConsent(gaId);
    window.gtag?.("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    blockLoadedVercelAnalytics();
    setChoice("unset");
  }

  if (!hydrated) return null;

  return (
    <>
      {choice === "accepted" ? (
        <>
          {firstPartyEnabled ? <AnalyticsProvider /> : null}
          {vercelEnabled && publicRoute ? <Analytics beforeSend={privacySafeVercelEvent} /> : null}
          {gaId ? (
            <PrivacySafeGoogleAnalytics gaId={gaId} pathname={pathname} publicRoute={publicRoute} />
          ) : null}
        </>
      ) : null}

      {choice === "unset" ? (
        <section
          aria-label="Analytics choices"
          className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-3xl border border-border-strong bg-surface p-4 shadow-xl sm:p-5"
          style={{ position: "fixed", zIndex: 2_147_483_000 }}
        >
          <div className="sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <h2 className="font-semibold">Optional analytics</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                Help us count visits and improve the workflow. Optional analytics never include invoice values, payer names, bank memos, or payment references. Necessary account, billing, reconciliation-completion, and audit records still operate when optional analytics are rejected. Read the <Link className="font-semibold text-brand hover:underline" href="/privacy#cookies">privacy choices</Link>.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-0 sm:shrink-0">
              <button type="button" className="min-h-10 border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-muted" onClick={() => saveChoice("rejected")}>Reject analytics</button>
              <button type="button" className="min-h-10 border border-brand bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover dark:text-[#10241b]" onClick={() => saveChoice("accepted")}>Accept analytics</button>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          className="fixed bottom-3 left-3 z-[70] border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-muted-strong shadow-sm hover:text-foreground"
          style={{ position: "fixed", zIndex: 2_147_482_999 }}
          onClick={reopenChoices}
        >
          Privacy choices
        </button>
      )}
    </>
  );
}
