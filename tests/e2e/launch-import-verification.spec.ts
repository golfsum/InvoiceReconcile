import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

// Explicitly opt in with an isolated account and workspace created for this test.
// Never supply a customer's workspace. Credentials are environment-only.
const email = process.env.LAUNCH_QA_EMAIL;
const password = process.env.LAUNCH_QA_PASSWORD;
const workspaceId = process.env.LAUNCH_QA_WORKSPACE_ID;
test.skip(process.env.LAUNCH_QA_ENABLED !== "true" || !email || !password || !workspaceId,
  "An isolated launch QA workspace is required");

test("saved billing summary is accessible and identifies the current plan", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  await page.goto(`/app/${workspaceId}/settings`);
  await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue(workspaceId!);
  await page.getByRole("link", { name: "Open billing", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Current plan: (Free|Solo|Business|Bookkeeper)$/ })).toBeVisible();
  await page.getByRole("link", { name: "Refresh billing status", exact: true }).click();
  await expect(page.getByRole("region", { name: "Current billing status" })).toContainText("payments per month. Status:");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("private CSV/XLSX uploads reconcile and export through the live UI", async ({ page }) => {
  test.slow();
  await page.goto("/auth/sign-in");
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  const path = `/app/${workspaceId}`;
  await page.goto(`${path}/imports`);
  // Refuse to submit data unless this is the specifically named fictional workspace.
  await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue(workspaceId!);
  await expect(page.getByRole("combobox", { name: "Workspace", exact: true }).locator("option:checked"))
    .toHaveText("Harbor Field Services QA");

  for (const [index, kind] of ["invoices", "payments"].entries()) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", {
      name: index === 0 ? "Open invoices" : "Incoming payments", exact: true,
    }) });
    const fixture = resolve(process.cwd(), `tests/fixtures/cedar-grove-qa-${kind}.csv`);
    if (test.info().project.name === "mobile-chromium") {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet(kind).addRows((await readFile(fixture, "utf8")).trim().split(/\r?\n/).map(row => row.split(",")));
      await section.locator('input[type="file"]').setInputFiles({
        name: `launch-qa-${kind}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      });
    } else {
      await section.locator('input[type="file"]').setInputFiles(fixture);
    }
    await expect(section.getByText("4 data rows", { exact: true })).toBeVisible({ timeout: 60_000 });
    await section.getByRole("button", { name: "Confirm mapping", exact: true }).click();
    await expect(section.getByRole("button", { name: "Mapping confirmed", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Queue reconciliation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path}/exceptions$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Review payment matches", exact: true })).toBeVisible();
  await page.goto(`${path}/exports`);
  const details = page.locator("section").filter({ has: page.getByRole("heading", { name: "Current reconciliation detail", exact: true }) });
  for (const format of ["CSV", "XLSX"] as const) {
    const pendingDownload = page.waitForEvent("download");
    await details.getByRole("button", { name: format, exact: true }).click();
    const download = await pendingDownload;
    expect(await download.failure()).toBeNull();
    const filename = await download.path();
    expect(filename).not.toBeNull();
    if (format === "CSV") {
      expect(await readFile(filename!, "utf8")).toContain("CG-QA-1001");
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filename!);
      expect(JSON.stringify(workbook.worksheets[0].getSheetValues())).toContain("CG-QA-1001");
    }
  }
});
