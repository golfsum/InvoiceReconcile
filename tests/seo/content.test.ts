import { describe, expect, it } from "vitest";
import { industryPages } from "@/content/seo/industries";
import { landingPages } from "@/content/seo/landing-pages";
import { resources } from "@/content/seo/resources";
import { solutionPages } from "@/content/seo/solutions";
import sitemap from "@/app/sitemap";
import { findLumpSumCombinations, parseAmountRows } from "@/content/seo/tools";

function allText(value: unknown) {
  return JSON.stringify(value);
}

describe("public SEO content inventory", () => {
  it("contains every requested core landing page", () => {
    expect(Object.keys(landingPages).sort()).toEqual([
      "accounts-receivable-reconciliation",
      "bank-deposit-to-invoice-matching",
      "cash-application-automation",
      "combined-payment-invoice-matching",
      "excel-invoice-reconciliation",
      "invoice-payment-matching",
      "invoice-reconciliation-for-bookkeepers",
      "invoice-reconciliation-software",
      "partial-payment-reconciliation",
      "payment-reconciliation-for-accounting-firms",
      "payment-reconciliation-for-small-business",
      "payment-reconciliation-software",
      "quickbooks-invoice-reconciliation",
      "quickbooks-payment-matching",
    ]);
  });

  it("contains twelve distinct educational resources", () => {
    expect(resources).toHaveLength(12);
    expect(new Set(resources.map((resource) => resource.slug)).size).toBe(12);
    expect(new Set(resources.map((resource) => resource.title)).size).toBe(12);
    for (const resource of resources) {
      expect(resource.sections.length).toBeGreaterThanOrEqual(5);
      expect(resource.takeaways.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("keeps related articles resolvable and sitemap dates aligned with actual content dates", () => {
    const entries = sitemap();
    for (const article of resources) {
      for (const slug of article.related) expect(resources.some((item) => item.slug === slug)).toBe(true);
      const entry = entries.find((item) => item.url.endsWith(`/resources/${article.slug}`));
      expect(entry).toBeDefined();
      expect(new Date(entry!.lastModified!).toISOString().slice(0, 10)).toBe(article.updated);
      expect((article.published || article.updated) <= article.updated).toBe(true);
      for (const section of article.sections) {
        for (const row of section.table?.rows || []) expect(row).toHaveLength(section.table!.headers.length);
      }
    }
  });

  it("balances every line of the fictional AR example", () => {
    const article = resources.find((item) => item.slug === "accounts-receivable-reconciliation-example")!;
    const table = article.sections.find((section) => section.table)!.table!;
    const amounts = table.rows.map((row) => row.slice(1).map((cell) => Number(cell.replace(/[$,]/g, ""))));
    for (const [opening, invoices, cash, credit, closing] of amounts) expect(opening + invoices - cash - credit).toBe(closing);
    for (let column = 0; column < 5; column++) expect(amounts.slice(0, -1).reduce((sum, row) => sum + row[column], 0)).toBe(amounts.at(-1)![column]);
  });

  it("matches the exact combination described by the tool walkthrough", () => {
    const rows = parseAmountRows("INV-2108, 1500\nINV-2141, 1225\nINV-2190, 2000\nINV-2203, 750\nINV-2210, 6200").rows;
    const matches = findLumpSumCombinations(472500, rows);
    expect(matches).toHaveLength(1);
    expect(matches[0].map((row) => row.label).sort()).toEqual(["INV-2108", "INV-2141", "INV-2190"]);
  });

  it("contains the requested audience inventories", () => {
    expect(Object.keys(solutionPages).sort()).toEqual(["accounting-firms", "bookkeepers", "small-business"]);
    expect(Object.keys(industryPages).sort()).toEqual(["accounting-firms", "b2b-services", "bookkeepers", "consulting", "home-services", "marketing-agencies", "wholesale-distribution"]);
  });

  it("does not include prohibited copy patterns", () => {
    const content = allText({ landingPages, resources, solutionPages, industryPages });
    expect(content).not.toContain(String.fromCodePoint(0x2014));
    expect(content.toLowerCase()).not.toContain("revolutionize");
    expect(content.toLowerCase()).not.toContain("game-changing");
    expect(content.toLowerCase()).not.toContain("supercharge");
    expect(content.toLowerCase()).not.toContain("soc 2 certified");
  });
});
