import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { rejectOptionalAnalytics } from "./helpers";

test("admin data is protected and the explicit local admin entry grants access", async ({ page }) => {
  await page.goto("/admin");
  await rejectOptionalAnalytics(page);

  await expect(page).toHaveURL(/\/auth\/sign-in\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("Know what is growing and what needs attention.")).toHaveCount(0);

  await page.goto("/dev/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Open the internal dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Continue as local admin" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Know what is growing and what needs attention." })).toBeVisible();
  await expect(page.getByText("Privacy-minimized activity")).toBeVisible();
  await expect(page.getByText("support@invoicereconcile.com")).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const report = accessibility.violations
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)
    .join("\n");
  expect(accessibility.violations, report).toEqual([]);
});
