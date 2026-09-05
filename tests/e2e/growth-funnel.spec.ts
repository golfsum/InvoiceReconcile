import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("manual dark theme keeps primary actions readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("ir_analytics_consent_v1", "rejected");
  });
  await page.goto("/pricing");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("link", { name: "Start free, no card needed" })).toHaveCSS("color", "rgb(16, 36, 27)");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("homepage has search metadata and a truthful path into sample exceptions", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Invoice Reconciliation Software for Bookkeepers | InvoiceReconcile");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/invoicereconcile\.com\/?$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", await page.title());
  await expect(page.getByRole("link", { name: "Reconcile 50 payments free" })).toHaveAttribute("href", "/auth/sign-up");
  await expect(page.getByText("Most popular", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reject analytics", exact: true }).click();
  const privacy = page.getByRole("button", { name: "Privacy choices", exact: true });
  await expect(privacy).toHaveCSS("position", "static");
  await privacy.click();
  await expect(page.getByRole("button", { name: "Accept analytics", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reject analytics", exact: true }).click();
  await page.getByRole("link", { name: "Explore the sample exceptions" }).click();
  await expect(page.getByRole("heading", { name: "Review payment matches", exact: true })).toBeVisible();
});

test("every sitemap page is crawlable with unique metadata and one canonical", async ({ request, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium" || browserName !== "chromium", "HTTP crawl is viewport independent");
  test.setTimeout(180_000);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  expect(new Set(urls).size).toBe(urls.length);
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (let offset = 0; offset < urls.length; offset += 4) {
    await Promise.all(urls.slice(offset, offset + 4).map(async (url) => {
      const response = await request.get(new URL(url).pathname);
      expect(response.status(), url).toBe(200);
      const html = await response.text();
      const title = html.match(/<title>(.*?)<\/title>/)?.[1];
      const description = html.match(/<meta name="description" content="(.*?)"/)?.[1];
      const canonicals = [...html.matchAll(/<link rel="canonical" href="(.*?)"/g)];
      expect(title, url).toBeTruthy();
      expect(description, url).toBeTruthy();
      expect.soft(titles.has(title!), `Duplicate title: ${url}`).toBe(false);
      expect.soft(descriptions.has(description!), `Duplicate description: ${url}`).toBe(false);
      titles.add(title!);
      descriptions.add(description!);
      expect(canonicals, url).toHaveLength(1);
      expect(new URL(canonicals[0][1]).href).toBe(new URL(url).href);
      expect(html, url).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
      expect([...html.matchAll(/<h1[\s>]/g)], url).toHaveLength(1);
    }));
  }
});

test("plan recommendation handles volume, workspaces, features, invalid and overflow input", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Free: $0/month" })).toBeVisible();
  await page.getByLabel("Payments per month", { exact: true }).fill("500");
  await expect(page.getByRole("heading", { name: "Solo: $19/month" })).toBeVisible();
  await page.getByLabel("Client workspaces", { exact: true }).fill("3");
  await expect(page.getByRole("heading", { name: "Business: $49/month" })).toBeVisible();
  await page.getByLabel("Client workspaces", { exact: true }).fill("4");
  await expect(page.getByRole("heading", { name: "Bookkeeper: $99/month" })).toBeVisible();
  await page.getByLabel("Client workspaces", { exact: true }).fill("1");
  await page.getByLabel("I need custom matching rules or colleague invitations").check();
  await expect(page.getByRole("heading", { name: "Business: $49/month" })).toBeVisible();
  await page.getByLabel("Payments per month", { exact: true }).fill("");
  await expect(page.getByText("Enter a whole number of payments", { exact: false })).toBeVisible();
  await page.getByLabel("Payments per month", { exact: true }).fill("10001");
  await expect(page.getByRole("heading", { name: "Your estimate exceeds our published plans." })).toBeVisible();
  await page.getByLabel("Payments per month", { exact: true }).fill("2500");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("link", { name: "Continue with Business" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up\?plan=business/);
  await expect(page.getByRole("heading", { name: "Reconcile your first file", exact: true })).toBeVisible();
});

test("search landing links to real sample downloads and a free workspace", async ({ page, request }) => {
  await page.goto("/excel-invoice-reconciliation");
  await expect(page.getByRole("link", { name: "Start my free workspace" })).toHaveAttribute("href", "/auth/sign-up");
  for (const kind of ["invoices", "payments"]) {
    const file = await request.get(`/sample-data/northstar-${kind}.csv`);
    expect(file.status()).toBe(200);
    expect((await file.text()).split("\n").length).toBeGreaterThan(20);
  }
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("2026-09-04");
  expect(xml).not.toMatch(/<loc>[^<]*\/(auth|app|api|settings)\//);
});
