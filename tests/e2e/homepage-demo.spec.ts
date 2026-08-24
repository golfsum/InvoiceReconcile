import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

test("the homepage demo exposes real narration and explainable decisions", async ({ page, request }) => {
  await page.goto("/");
  await rejectOptionalAnalytics(page);

  await expect(page.getByRole("heading", { level: 1, name: "Stop matching invoice payments by hand." })).toBeVisible();

  const demo = page.locator("#demo");
  await expect(demo.getByRole("heading", { name: "Watch the matching logic, then inspect the evidence." })).toBeVisible();
  await expect(demo.locator("audio")).toHaveAttribute("src", "/audio/combined-payment-demo.mp3");

  const narration = await request.get("/audio/combined-payment-demo.mp3");
  expect(narration.ok()).toBe(true);
  expect(narration.headers()["content-type"]).toContain("audio/mpeg");
  expect((await narration.body()).byteLength).toBeGreaterThan(10_000);

  await demo.getByRole("button", { name: "Play walkthrough" }).click();
  await expect(demo.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect.poll(() => demo.locator("audio").evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await demo.getByRole("button", { name: "Pause" }).click();

  await demo.getByRole("button", { name: "Inspect evidence" }).click();
  await expect(demo.getByText("Exact total")).toBeVisible();
  await expect(demo.getByText("Normalized name agrees")).toBeVisible();
  await demo.getByRole("button", { name: "Confirm match" }).click();
  await expect(demo.getByRole("button", { name: "Confirmed for export" })).toBeDisabled();

  await demo.getByRole("tab", { name: "Fee difference" }).click();
  await expect(demo.getByRole("tab", { name: "Fee difference" })).toHaveAttribute("aria-selected", "true");
  await expect(demo.locator("audio")).toHaveAttribute("src", "/audio/fee-difference-demo.mp3");
  await expect(demo.getByText("Review $150.00 difference")).toBeVisible();
  await expect(demo.getByText("A $4,850.00 deposit arrives against a $5,000.00 invoice.")).toBeVisible();

  await demo.getByRole("button", { name: "Keep in review" }).click();
  await expect(demo.getByText("The discrepancy stays in review until a person decides.")).toBeVisible();
  await expect(demo.getByRole("button", { name: "Left in review" })).toBeDisabled();
});
