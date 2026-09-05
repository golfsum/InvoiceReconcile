import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConsentAnalytics } from "@/components/analytics/consent-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { siteConfig } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "InvoiceReconcile | Match incoming payments to invoices",
    template: "%s | InvoiceReconcile",
  },
  description:
    "Match CSV and XLSX payments to open invoices, including combined payments, partials, and fees. Review the evidence, confirm matches, and export results.",
  applicationName: siteConfig.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: "Stop matching invoice payments by hand.",
    description:
      "Import invoice and payment exports. Investigate exceptions, confirm matches, and keep a reviewable record.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stop matching invoice payments by hand.",
    description:
      "InvoiceReconcile finds exact matches, combined payments, partials, and discrepancies.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#111514" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const vercelAnalytics = process.env.NEXT_PUBLIC_VERCEL_ANALYTICS_ENABLED === "true";
  const firstPartyAnalytics = process.env.NEXT_PUBLIC_FIRST_PARTY_ANALYTICS_ENABLED !== "false";

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster richColors closeButton position="top-center" />
          <ConsentAnalytics firstPartyEnabled={firstPartyAnalytics} gaId={gaId} vercelEnabled={vercelAnalytics} />
        </ThemeProvider>
      </body>
    </html>
  );
}
