import { expect, test } from "@playwright/test";

const productionOrigin = "https://invoicereconcile.com";

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function sitemapLocations(xml: string) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1]));
}

function publicInternalLinks(html: string) {
  return [...html.matchAll(/\shref=["']([^"']+)["']/g)]
    .map((match) => decodeXml(match[1]))
    .filter((href) => href.startsWith("/") && !href.startsWith("//"))
    .map((href) => href.split("#", 1)[0])
    .filter((href) => href && !href.startsWith("/api/") && !href.startsWith("/app/") && !href.startsWith("/auth/") && !href.startsWith("/admin") && !href.startsWith("/settings/"));
}

function canonicalHref(html: string) {
  const tag = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i)?.[0]
    || html.match(/<link\s+[^>]*href=["'][^"']+["'][^>]*rel=["']canonical["'][^>]*>/i)?.[0];
  return tag?.match(/href=["']([^"']+)["']/i)?.[1] || null;
}

test("the sitemap and every linked public route resolve with launch metadata", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "A single HTTP crawl covers both viewport projects.");

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  expect(sitemapResponse.headers()["content-type"]).toContain("application/xml");

  const locations = sitemapLocations(await sitemapResponse.text());
  expect(locations.length).toBeGreaterThan(40);
  expect(new Set(locations).size).toBe(locations.length);
  expect(locations.every((location) => location.startsWith(`${productionOrigin}/`))).toBe(true);

  const knownPaths = new Set(locations.map((location) => new URL(location).pathname));
  const discoveredPaths = new Set<string>();
  const failures: string[] = [];

  for (const location of locations) {
    const canonicalPath = new URL(location).pathname;
    const response = await request.get(canonicalPath);
    if (response.status() !== 200) {
      failures.push(`${canonicalPath}: HTTP ${response.status()}`);
      continue;
    }

    const html = await response.text();
    if (!/<h1(?:\s|>)/i.test(html)) failures.push(`${canonicalPath}: missing h1`);
    if (!/<meta\s+name=["']description["'][^>]+content=["'][^"']+/i.test(html)
      && !/<meta\s+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html)) {
      failures.push(`${canonicalPath}: missing meta description`);
    }
    if (/name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)) failures.push(`${canonicalPath}: unexpectedly noindex`);

    const canonical = canonicalHref(html);
    if (!canonical || new URL(canonical).origin !== productionOrigin || new URL(canonical).pathname !== canonicalPath) {
      failures.push(`${canonicalPath}: canonical does not match sitemap`);
    }

    for (const path of publicInternalLinks(html)) discoveredPaths.add(path);
  }

  for (const path of discoveredPaths) {
    if (knownPaths.has(path)) continue;
    const response = await request.get(path);
    if (response.status() >= 400) failures.push(`${path}: linked route returned HTTP ${response.status()}`);
  }

  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain(`Sitemap: ${productionOrigin}/sitemap.xml`);

  expect(failures, failures.join("\n")).toEqual([]);
});
