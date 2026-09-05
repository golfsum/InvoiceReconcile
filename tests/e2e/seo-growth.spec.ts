import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

const articles = [
  ["accounts-receivable-reconciliation-example", "Accounts receivable reconciliation example: invoices to closing balance"],
  ["how-to-reconcile-bank-deposits-with-invoices", "How to reconcile bank deposits with invoices: three worked cases"],
  ["cash-application-explained-for-small-businesses", "What is cash application? Meaning, process and examples"],
] as const;

for (const [slug, title] of articles) {
  test(`SEO article ${slug} renders with canonical and dated structured data`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(`/resources/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://invoicereconcile.com/resources/${slug}`);
    await expect(page.locator("time")).toHaveText("Updated September 5, 2026");
    const schema = await page.locator('script[type="application/ld+json"]').evaluateAll((elements) => elements.map((element) => JSON.parse(element.textContent || "{}")));
    expect(schema.find((item) => item["@type"] === "Article").dateModified).toBe("2026-09-05");
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("new guide leads to the working sample matcher", async ({ page }) => {
  await page.goto("/resources/how-to-reconcile-bank-deposits-with-invoices");
  await rejectOptionalAnalytics(page);
  await page.getByRole("link", { name: "Test the $4,725 example", exact: true }).click();
  await expect(page).toHaveURL(/\/tools\/lump-sum-invoice-matcher$/);
  await page.getByRole("button", { name: "Find combinations" }).click();
  const results = page.getByRole("region", { name: "Possible invoice combinations" });
  await expect(results).toContainText("Found 1 exact combination");
  for (const invoice of ["INV-2108", "INV-2141", "INV-2190"]) await expect(results).toContainText(invoice);
  await page.getByLabel("Payment amount", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Find combinations" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Enter a positive payment amount");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("footer links expose previously unlinked hubs and core pages", async ({ page, request }) => {
  await page.goto("/");
  for (const href of ["/solutions", "/industries", "/invoice-reconciliation-software", "/accounts-receivable-reconciliation"]) {
    await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
    expect((await request.get(href)).status()).toBe(200);
  }
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const [slug] of articles) expect(sitemap).toContain(`/resources/${slug}`);
});
