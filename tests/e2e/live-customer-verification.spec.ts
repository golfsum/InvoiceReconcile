import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { rejectOptionalAnalytics } from "./helpers";

// Opt-in only: use a dedicated fictional QA account with the Cedar Grove fixtures.
const email = process.env.LIVE_QA_EMAIL;
const password = process.env.LIVE_QA_PASSWORD;
const workspaceId = process.env.LIVE_QA_WORKSPACE_ID;
test.skip(!email?.startsWith("qa-") || !password || !workspaceId, "Dedicated live QA credentials are required");

test("saved customer data survives reload and exports valid CSV and XLSX", async ({ page }) => {
  test.slow();
  await page.goto("/auth/sign-in");
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  const path = `/app/${workspaceId}`;

  for (const section of ["invoices", "payments", "exceptions", "audit", "settings"]) {
    await page.goto(`${path}/${section}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("This view could not be loaded.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Workspace data is temporarily unavailable", { exact: false })).toHaveCount(0);
  }

  await page.goto(`${path}/exports`);
  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open workspace navigation" }).click();
  }
  await expect(page.getByRole("link", { name: "Matching rules", exact: true })).toBeVisible();
  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Close workspace navigation" }).click();
  }
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Current reconciliation detail", exact: true }) });
  for (const format of ["CSV", "XLSX"] as const) {
    const downloaded = page.waitForEvent("download");
    await section.getByRole("button", { name: format, exact: true }).click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    const file = await download.path();
    expect(file).not.toBeNull();
    if (format === "CSV") {
      const csv = await readFile(file!, "utf8");
      expect(csv).toContain("CG-QA-1001");
      expect(csv).toContain("ASPEN STUDIO LLC");
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file!);
      expect(workbook.worksheets[0].rowCount).toBeGreaterThan(4);
      expect(JSON.stringify(workbook.worksheets[0].getSheetValues())).toContain("CG-QA-1001");
    }
  }
  await page.screenshot({ path: test.info().outputPath("live-customer-exports.png"), fullPage: true });
});

test("the same private records can be imported again as CSV or XLSX safely", async ({ page }) => {
  test.slow();
  await page.goto("/auth/sign-in");
  await rejectOptionalAnalytics(page);
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  await page.goto(`/app/${workspaceId}/imports`);
  for (const [index, kind] of ["invoices", "payments"].entries()) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: index === 0 ? "Open invoices" : "Incoming payments", exact: true }) });
    const fixture = resolve(process.cwd(), `tests/fixtures/cedar-grove-qa-${kind}.csv`);
    if (test.info().project.name === "mobile-chromium") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(kind);
      // These controlled fixtures contain no quoted commas or multiline cells.
      sheet.addRows((await readFile(fixture, "utf8")).trim().split(/\r?\n/).map(row => row.split(",")));
      await section.locator('input[type="file"]').setInputFiles({
        name: `cedar-grove-qa-${kind}.xlsx`,
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
  const queued = page.waitForResponse(response => new URL(response.url()).pathname === "/api/reconciliation/async" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Queue reconciliation", exact: true }).click();
  const response = await queued;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/app/${workspaceId}/exceptions$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Review payment matches", exact: true })).toBeVisible();
});
