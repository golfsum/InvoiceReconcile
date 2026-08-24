import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", ".next", "node_modules", "coverage", "playwright-report", "test-results", "scaffold-invoicereconcile", ".scaffold-invoicereconcile"]);
const ignoredFiles = new Set(["AGENTS.md"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".sql", ".txt", ".csv", ".svg"]);
const banned = [
  { pattern: "\u2014", label: "em dash" },
  { pattern: ["Lorem", "ipsum"].join(" "), label: "placeholder copy" },
];
const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    if (ignoredFiles.has(relative(root, join(directory, entry.name)))) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const content = await readFile(fullPath, "utf8");
    for (const item of banned) {
      if (content.includes(item.pattern)) {
        failures.push(`${relative(root, fullPath)} contains ${item.label}`);
      }
    }
  }
}

await walk(root);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Copy checks passed.");
