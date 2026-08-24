import { describe, expect, it } from "vitest";
import { industryPages } from "@/content/seo/industries";
import { landingPages } from "@/content/seo/landing-pages";
import { resources } from "@/content/seo/resources";
import { solutionPages } from "@/content/seo/solutions";

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

  it("contains ten distinct educational resources", () => {
    expect(resources).toHaveLength(10);
    expect(new Set(resources.map((resource) => resource.slug)).size).toBe(10);
    expect(new Set(resources.map((resource) => resource.title)).size).toBe(10);
    for (const resource of resources) {
      expect(resource.sections.length).toBeGreaterThanOrEqual(5);
      expect(resource.takeaways.length).toBeGreaterThanOrEqual(5);
    }
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
