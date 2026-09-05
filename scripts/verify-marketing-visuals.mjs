import { chromium } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3011";
const directory = await mkdtemp(join(tmpdir(), "ir-growth-visuals-"));
const browser = await chromium.launch();
const coverage = [];
try {
  for (const [device, width, height] of [["desktop", 1440, 1000], ["small-phone", 375, 667], ["phone", 390, 844], ["large-phone", 430, 932], ["android", 412, 915]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("ir_analytics_consent_v1", "rejected"));
    for (const path of ["/", "/pricing", "/excel-invoice-reconciliation"]) {
      await page.goto(new URL(path, baseURL).href);
      await page.getByRole("button", { name: "Privacy choices", exact: true }).waitFor({ state: "attached" });
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ height: innerHeight, scroll: document.documentElement.scrollHeight, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      if (dimensions.scrollWidth > dimensions.width) throw new Error(`Horizontal page overflow on ${device} ${path}`);
      const maximum = Math.max(0, dimensions.scroll - dimensions.height);
      const step = dimensions.height - 120;
      const positions = [];
      for (let y = 0; y < maximum; y += step) positions.push(y);
      positions.push(maximum);
      const frames = [];
      for (const [index, y] of positions.entries()) {
        await page.evaluate((top) => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, top); }, y);
        const actual = await page.evaluate(() => window.scrollY);
        if (Math.abs(actual - y) > 1) throw new Error(`Scroll coverage mismatch: ${actual} versus ${y}`);
        const file = join(directory, `${device}-${path === "/" ? "home" : path.slice(1)}-${String(index).padStart(2, "0")}.png`);
        await page.screenshot({ path: file, animations: "disabled" });
        frames.push({ y: actual, file });
      }
      const finalMaximum = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - innerHeight));
      if (Math.abs(finalMaximum - maximum) > 1) throw new Error(`Page height changed during capture on ${device} ${path}`);
      coverage.push({ device, path, dimensions, maximum, frames });
    }
    await page.close();
  }
  await writeFile(join(directory, "coverage.json"), JSON.stringify(coverage, null, 2));
  console.log(JSON.stringify({ directory, pages: coverage.length, frames: coverage.reduce((sum, item) => sum + item.frames.length, 0) }));
} finally {
  await browser.close();
}
