import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", heading: "Stop matching invoice payments by hand." },
  { path: "/terms", heading: "Terms of Service" },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/contact", heading: "Contact InvoiceReconcile" },
  { path: "/app/exceptions", heading: "Exceptions across all clients" },
  { path: "/app/demo/exceptions", heading: "Review payment matches" },
] as const;

for (const route of routes) {
  test(`${route.path} has no automated WCAG A or AA violations`, async ({ page }) => {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const report = results.violations
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
      .join("\n");

    expect(results.violations, report).toEqual([]);
  });
}
