import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("contact route path minimization", () => {
  it("templates dynamic private path identifiers before storage or email delivery", () => {
    const route = readFileSync(
      resolve(process.cwd(), "src/app/api/contact/route.ts"),
      "utf8",
    );

    expect(route).toContain("analyticsPathTemplate(parsed.data.sourcePath)");
    expect(route).toContain("source_path: minimizedContact.sourcePath");
    expect(route).toContain("sendContactEmails({ ...minimizedContact, requestId })");
  });
});
