import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

test("bookkeeper portfolio opens a truthful firm-wide exception inbox", async ({ page }) => {
  await page.goto("/app/workspaces");
  await rejectOptionalAnalytics(page);
  await expect(page.getByRole("heading", { level: 1, name: "Client workspaces" })).toBeVisible();
  await page.getByRole("link", { name: /Review 24 across all clients/ }).click();

  await expect(page).toHaveURL(/\/app\/exceptions$/);
  await expect(page.getByRole("heading", { level: 1, name: "Exceptions across all clients" })).toBeVisible();
  await expect(page.getByText("24", { exact: true })).toBeVisible();
  await expect(page.getByText("Across 3 client workspaces")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open client queue" })).toHaveCount(3);
});
