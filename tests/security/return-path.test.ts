import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/lib/utils";

describe("safeReturnPath", () => {
  it("keeps normal local paths with a query string", () => {
    expect(safeReturnPath("/app/workspaces?from=login", "/app")).toBe("/app/workspaces?from=login");
  });

  it.each([
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/%5cattacker.example",
    "/%2f%2fattacker.example",
  ])("rejects unsafe return target %s", (value) => {
    expect(safeReturnPath(value, "/app")).toBe("/app");
  });
});
