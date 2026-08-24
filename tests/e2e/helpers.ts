import type { Page } from "@playwright/test";

export async function rejectOptionalAnalytics(page: Page) {
  const reject = page.getByRole("button", { name: "Reject analytics" });
  try {
    await reject.waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }

  // Playwright's locator click can scroll a fixed element against the mobile
  // layout viewport before dispatching the event. Confirm the button really is
  // the topmost hit target, then activate it without that synthetic scroll.
  const isTopmost = await reject.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return target === button || (target !== null && button.contains(target));
  });

  if (!isTopmost) {
    throw new Error("The analytics rejection control is not the topmost hit target.");
  }

  await reject.evaluate((button: HTMLButtonElement) => button.click());
  await reject.waitFor({ state: "hidden" });
}
