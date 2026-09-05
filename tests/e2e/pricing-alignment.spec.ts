import { expect, test } from "@playwright/test";
import { rejectOptionalAnalytics } from "./helpers";

for (const width of [375, 768, 1024, 1440]) {
  test(`pricing actions share a baseline within each card row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/pricing");
    await rejectOptionalAnalytics(page);
    if (width < 1024) {
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).getByRole("link", { name: "Pricing", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
    }
    const cards = page.locator("article");
    await expect(cards).toHaveCount(4);
    const geometry = await cards.evaluateAll((elements) => elements.map((card) => {
      const button = card.querySelector("a")!;
      const cardRect = card.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return { row: cardRect.top, top: buttonRect.top, height: buttonRect.height, width: buttonRect.width, bottomGap: cardRect.bottom - buttonRect.bottom };
    }));
    for (const card of geometry) {
      expect(card.height).toBeGreaterThanOrEqual(40);
      expect(card.bottomGap).toBeCloseTo(24, 0);
      expect(card.width).toBeCloseTo(geometry[0].width, 0);
      for (const peer of geometry.filter((item) => Math.abs(item.row - card.row) < 1)) {
        expect(card.top).toBeCloseTo(peer.top, 0);
        expect(card.height).toBeCloseTo(peer.height, 0);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const planKeys = ["free", "solo", "business", "bookkeeper"];
    for (const [index, plan] of planKeys.entries()) {
      const action = cards.nth(index).getByRole("link");
      await expect(action).toHaveAttribute("href", `/auth/sign-up?plan=${plan}`);
      await action.click();
      await expect(page).toHaveURL(new RegExp(`/auth/sign-up\\?plan=${plan}$`));
      await expect(page.getByRole("heading", { name: "Reconcile your first file", exact: true })).toBeVisible();
      await page.goto("/pricing");
    }
  });
}
