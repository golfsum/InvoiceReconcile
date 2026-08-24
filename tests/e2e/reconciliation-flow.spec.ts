import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

test("fictional invoice and payment files reconcile into the review queue", async ({ page }) => {
  test.slow();
  await page.goto("/app/demo/imports");
  await rejectOptionalAnalytics(page);

  await expect(page.getByRole("heading", { level: 1, name: "Bring invoices and incoming payments" })).toBeVisible();

  const invoiceImport = page.locator("section").filter({ has: page.getByRole("heading", { name: "Open invoices" }) });
  const paymentImport = page.locator("section").filter({ has: page.getByRole("heading", { name: "Incoming payments" }) });

  const invoicePreviewResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/imports/preview"
    && response.request().method() === "POST",
  );
  await invoiceImport.getByRole("button", { name: "Use fictional sample invoices" }).click();
  const invoicePreview = await invoicePreviewResponse;
  expect(invoicePreview.status(), await invoicePreview.text()).toBe(200);
  await expect(invoiceImport.getByText("30 data rows")).toBeVisible({ timeout: 10_000 });
  await invoiceImport.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(invoiceImport.getByRole("button", { name: "Mapping confirmed" })).toBeVisible();

  const paymentPreviewResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/imports/preview"
    && response.request().method() === "POST",
  );
  await paymentImport.getByRole("button", { name: "Use fictional sample payments" }).click();
  const paymentPreview = await paymentPreviewResponse;
  expect(paymentPreview.status(), await paymentPreview.text()).toBe(200);
  await expect(paymentImport.getByText("22 data rows")).toBeVisible({ timeout: 10_000 });
  await paymentImport.getByRole("button", { name: "Confirm mapping" }).click();
  await expect(paymentImport.getByRole("button", { name: "Mapping confirmed" })).toBeVisible();

  const runButton = page.getByRole("button", { name: "Run reconciliation" });
  await expect(runButton).toBeEnabled();
  await runButton.click();

  await expect(page).toHaveURL(/\/app\/demo\/exceptions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Review payment matches" })).toBeVisible();
  await expect(page.getByText("Match explanation")).toBeVisible();

  const savedRun = await page.evaluate(() => {
    const raw = window.localStorage.getItem("ir_reconciliation_demo_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      runId: string;
      invoices: unknown[];
      payments: unknown[];
      result: { matches: unknown[] };
      importSummary: Record<string, number>;
    };
    return {
      runId: parsed.runId,
      invoices: parsed.invoices.length,
      payments: parsed.payments.length,
      matches: parsed.result.matches.length,
      importSummary: parsed.importSummary,
    };
  });

  expect(savedRun).not.toBeNull();
  expect(savedRun?.runId).not.toBe("fictional-demo");
  expect(savedRun).toMatchObject({
    invoices: 30,
    payments: 21,
    matches: 19,
    importSummary: {
      invoiceRows: 30,
      invoicesAccepted: 30,
      invoicesRejected: 0,
      paymentRows: 22,
      paymentsAccepted: 21,
      paymentsRejected: 1,
    },
  });
});
