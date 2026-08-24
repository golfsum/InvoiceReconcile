import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "10.5.0.2"],
  turbopack: { root: process.cwd() },
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const scriptSources = ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"];
    if (!isProduction) scriptSources.push("'unsafe-eval'");
    let supabaseOrigin = "";
    try {
      supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";
    } catch {
      // Keep the build operable with an incomplete local environment file.
    }
    const contentSecurityPolicyDirectives = [
      "default-src 'self'",
      `script-src ${scriptSources.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://www.google-analytics.com",
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseOrigin} https://vitals.vercel-insights.com https://www.google-analytics.com https://region1.google-analytics.com`.replace(/\s+/g, " ").trim(),
      "frame-src 'self' https://checkout.stripe.com https://billing.stripe.com",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ];
    if (isProduction) contentSecurityPolicyDirectives.push("upgrade-insecure-requests");
    const contentSecurityPolicy = contentSecurityPolicyDirectives.join("; ");
    const securityHeaders = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
    ];
    if (isProduction) securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
    return [{
      source: "/:path*",
      headers: securityHeaders,
    }];
  },
};

export default withWorkflow(nextConfig);
