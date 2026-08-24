import { describe, expect, it } from "vitest";
import {
  amountInputToMinor,
  defaultInvoiceAllocations,
  minorToAmountInput,
  validateInvoiceAllocations,
  type Invoice,
  type ProposedMatch,
} from "@/lib/reconciliation";

function invoice(id: string, outstandingAmountMinor: number, currency = "USD"): Invoice {
  return {
    id,
    invoiceNumber: id.toUpperCase(),
    customerName: "Test customer",
    invoiceDate: "2026-08-23",
    originalAmountMinor: outstandingAmountMinor,
    outstandingAmountMinor,
    currency,
    status: "open",
  };
}

const match = {
  invoiceIds: ["one", "two"],
  appliedAmountMinor: 9_000,
  paymentAmountMinor: 10_000,
} satisfies Pick<ProposedMatch, "invoiceIds" | "appliedAmountMinor" | "paymentAmountMinor">;

describe("minor-unit allocation input", () => {
  it("converts exact decimal strings without floating-point rounding", () => {
    expect(amountInputToMinor("10")).toBe(1_000);
    expect(amountInputToMinor("10.05")).toBe(1_005);
    expect(amountInputToMinor("0.1")).toBe(10);
    expect(minorToAmountInput(1_005)).toBe("10.05");
  });

  it.each(["", "-1", ".50", "1.234", "1e3", "90071992547410.00"])(
    "rejects a non-canonical or unsafe amount: %s",
    (value) => expect(amountInputToMinor(value)).toBeNull(),
  );
});

describe("invoice allocation validation", () => {
  const invoices = new Map([
    ["one", invoice("one", 6_000)],
    ["two", invoice("two", 5_000)],
    ["eur", invoice("eur", 1_000, "EUR")],
  ]);

  it("builds the suggested allocation while preserving the proposed partial total", () => {
    expect(defaultInvoiceAllocations(match, invoices)).toEqual([
      { invoiceId: "one", amountMinor: 6_000 },
      { invoiceId: "two", amountMinor: 3_000 },
    ]);
  });

  it("accepts an explicit split and reports the unapplied payment remainder", () => {
    expect(validateInvoiceAllocations({
      allocations: [
        { invoiceId: "one", amountMinor: 5_500 },
        { invoiceId: "two", amountMinor: 4_000 },
      ],
      appliedAmountMinor: 9_500,
      paymentAvailableMinor: 10_000,
      paymentCurrency: "USD",
      invoices,
    })).toEqual({ ok: true, totalMinor: 9_500, remainingPaymentMinor: 500 });
  });

  it.each([
    {
      allocations: [{ invoiceId: "one", amountMinor: 1_000 }, { invoiceId: "one", amountMinor: 1_000 }],
      appliedAmountMinor: 2_000,
      error: "Each invoice can appear only once.",
    },
    {
      allocations: [{ invoiceId: "one", amountMinor: 1.5 }],
      appliedAmountMinor: 2,
      error: "Every invoice allocation must be greater than zero.",
    },
    {
      allocations: [{ invoiceId: "eur", amountMinor: 500 }],
      appliedAmountMinor: 500,
      error: "Every selected invoice must use the payment currency.",
    },
    {
      allocations: [{ invoiceId: "two", amountMinor: 5_001 }],
      appliedAmountMinor: 5_001,
      error: "The allocation for this invoice exceeds its outstanding balance.",
    },
    {
      allocations: [{ invoiceId: "one", amountMinor: 6_000 }, { invoiceId: "two", amountMinor: 5_000 }],
      appliedAmountMinor: 11_000,
      error: "The invoice allocations exceed the available payment amount.",
    },
    {
      allocations: [{ invoiceId: "one", amountMinor: 5_000 }],
      appliedAmountMinor: 4_000,
      error: "The applied total must equal the sum of the invoice allocations.",
    },
  ])("rejects invalid allocations: $error", ({ allocations, appliedAmountMinor, error }) => {
    expect(validateInvoiceAllocations({
      allocations,
      appliedAmountMinor,
      paymentAvailableMinor: 10_000,
      paymentCurrency: "USD",
      invoices,
    })).toEqual({ ok: false, error });
  });
});
