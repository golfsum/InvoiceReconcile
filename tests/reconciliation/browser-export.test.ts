import { describe, expect, it } from "vitest";
import {
  safeWorkspaceArchiveFilename,
  workspaceArchiveColumnSelections,
  workspaceArchiveTableNames,
} from "@/lib/reconciliation/browser-export";

describe("workspace browser archive", () => {
  it("includes durable and workspace-scoped operational data", () => {
    expect(workspaceArchiveTableNames).toEqual(expect.arrayContaining([
      "reconciliation_runs",
      "usage_records",
      "integrations",
      "feedback",
    ]));
  });

  it("omits secret and internal-only fields from scoped metadata", () => {
    expect(workspaceArchiveColumnSelections.integrations).not.toContain("secret_reference");
    expect(workspaceArchiveColumnSelections.feedback).not.toContain("admin_notes");
    expect(workspaceArchiveColumnSelections.audit_events).not.toContain("ip_hash");
    expect(workspaceArchiveColumnSelections.audit_events).not.toContain("user_agent");
  });

  it("creates a bounded safe filename from a workspace name", () => {
    expect(safeWorkspaceArchiveFilename("  Smith & Sons / AR  ")).toBe("smith-sons-ar");
    expect(safeWorkspaceArchiveFilename("../")).toBe("workspace");
    expect(safeWorkspaceArchiveFilename("A".repeat(120))).toHaveLength(80);
  });
});
