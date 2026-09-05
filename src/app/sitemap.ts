import type { MetadataRoute } from "next";
import { industrySlugs } from "@/content/seo/industries";
import { landingPageSlugs } from "@/content/seo/landing-pages";
import { resources } from "@/content/seo/resources";
import { solutionSlugs } from "@/content/seo/solutions";
import { siteConfig } from "@/lib/config";

const updated = new Date("2026-08-23T00:00:00.000Z");
const growthUpdated = new Date("2026-09-04T00:00:00.000Z");
const tools = ["lump-sum-invoice-matcher", "invoice-payment-matcher", "reconciliation-time-calculator", "partial-payment-allocation", "invoice-reference-cleaner"];

export default function sitemap(): MetadataRoute.Sitemap {
  const revisedPaths = new Set(["/resources", "/tools/lump-sum-invoice-matcher", "/accounts-receivable-reconciliation"]);
  const entry = (path: string, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"], priority: number) => ({ url: new URL(path, siteConfig.url).toString(), lastModified: revisedPaths.has(path) ? new Date("2026-09-05T00:00:00Z") : path === "/" || path === "/pricing" || path === "/industries/bookkeepers" || path.startsWith("/solutions/") || landingPageSlugs.some((slug) => path === `/${slug}`) ? growthUpdated : updated, changeFrequency, priority });
  return [
    entry("/", "weekly", 1),
    entry("/product", "monthly", 0.9),
    entry("/pricing", "monthly", 0.9),
    entry("/security", "monthly", 0.7),
    entry("/contact", "yearly", 0.5),
    entry("/privacy", "yearly", 0.3),
    entry("/terms", "yearly", 0.3),
    entry("/resources", "weekly", 0.8),
    entry("/tools", "monthly", 0.8),
    entry("/solutions", "monthly", 0.8),
    entry("/industries", "monthly", 0.75),
    entry("/compare/spreadsheets-vs-invoice-reconciliation-software", "monthly", 0.7),
    ...landingPageSlugs.map((slug) => entry(`/${slug}`, "monthly", 0.8)),
    ...solutionSlugs.map((slug) => entry(`/solutions/${slug}`, "monthly", 0.75)),
    ...industrySlugs.map((slug) => entry(`/industries/${slug}`, "monthly", 0.65)),
    ...resources.map((article) => ({ ...entry(`/resources/${article.slug}`, "monthly", 0.7), lastModified: new Date(`${article.updated}T00:00:00Z`) })),
    ...tools.map((slug) => entry(`/tools/${slug}`, "monthly", 0.75)),
  ];
}
