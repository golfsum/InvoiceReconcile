import { describe, expect, it } from "vitest";
import { parseReconciliationEntitlement } from "@/lib/billing/entitlements";
import {
  parsePersistRpcResult,
  persistFailureKind,
  persistFailureMessage,
} from "@/lib/reconciliation/rpc-result";

describe("reconciliation RPC result parsing", () => {
  it("accepts wrapped and date-coerced capacity reservations", () => {
    expect(parseReconciliationEntitlement([{
      allowed: true,
      code: "allowed",
      plan: "free",
      limit: "50",
      used: "0",
      requested: "21",
      remaining: "29",
      period_start: "2026-09-01T00:00:00+00:00",
      period_end: "2026-09-30T00:00:00.000Z",
      existing: "false",
      reservation_id: "11700000-0000-4000-8000-000000000002",
    }])).toMatchObject({
      allowed: true,
      limit: 50,
      requested: 21,
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      existing: false,
    });
  });

  it("accepts a persist receipt wrapped as a single-row array or JSON string", () => {
    const receipt = {
      run_record_id: "11700000-0000-4000-8000-000000000001",
      saved_at: new Date("2026-09-04T03:14:22.000Z"),
      new_payment_count: 21,
      duplicate_payment_count: 0,
      carried_payment_count: 0,
      resolved_payment_count: 0,
      duplicate_invoice_count: 0,
    };
    expect(parsePersistRpcResult([receipt])).toMatchObject({
      runRecordId: "11700000-0000-4000-8000-000000000001",
      savedAt: "2026-09-04T03:14:22.000Z",
      canonicalCounts: { newPayments: 21 },
    });
    expect(parsePersistRpcResult(JSON.stringify({
      run_record_id: receipt.run_record_id,
      saved_at: "2026-09-04T03:14:22+00:00",
    }))).toMatchObject({
      runRecordId: receipt.run_record_id,
      savedAt: "2026-09-04T03:14:22+00:00",
    });
  });

  it("maps persist failures without calling the workspace save a storage outage", () => {
    expect(persistFailureKind("40001")).toBe("conflict");
    expect(persistFailureKind("22023")).toBe("records");
    expect(persistFailureMessage("records", true)).toContain("sample run could not be saved");
    expect(persistFailureMessage("unavailable", true)).not.toContain("durable storage");
  });
});
