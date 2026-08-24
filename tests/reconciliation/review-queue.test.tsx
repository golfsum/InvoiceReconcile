import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "@/components/app/review-queue";
import type { Invoice, Payment, ProposedMatch } from "@/lib/reconciliation";

const sendAnalyticsEvent = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/components/analytics/analytics-provider", () => ({ sendAnalyticsEvent }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const invoices: Invoice[] = [
  {
    id: "invoice-one",
    invoiceNumber: "INV-1001",
    customerName: "Northstar Services",
    invoiceDate: "2026-08-01",
    originalAmountMinor: 6_000,
    outstandingAmountMinor: 6_000,
    currency: "USD",
    status: "open",
  },
  {
    id: "invoice-two",
    invoiceNumber: "INV-1002",
    customerName: "Northstar Services",
    invoiceDate: "2026-08-02",
    originalAmountMinor: 5_000,
    outstandingAmountMinor: 5_000,
    currency: "USD",
    status: "open",
  },
];

const payments: Payment[] = [{
  id: "payment-one",
  paymentDate: "2026-08-23",
  amountMinor: 10_000,
  currency: "USD",
  payerName: "Northstar Services",
  transactionId: "BANK-1001",
}];

const matches: ProposedMatch[] = [{
  id: "match-one",
  paymentIds: ["payment-one"],
  invoiceIds: ["invoice-one", "invoice-two"],
  confidence: "review",
  method: "combined_invoices",
  paymentAmountMinor: 10_000,
  invoiceAmountMinor: 11_000,
  appliedAmountMinor: 10_000,
  discrepancyMinor: 0,
  remainingInvoiceBalanceMinor: 1_000,
  unappliedPaymentMinor: 0,
  requiresConfirmation: true,
  reasons: ["Two invoices may explain this payment."],
  evidence: [{ code: "amount_combined", message: "The selected amounts equal the payment.", strength: "strong" }],
}];

afterEach(() => {
  window.localStorage.clear();
  sendAnalyticsEvent.mockReset();
  refresh.mockReset();
});

describe("ReviewQueue explicit allocations", () => {
  it("stores the reviewer-entered split and emits only safe decision analytics", async () => {
    render(<ReviewQueue workspaceId="demo" matches={matches} invoices={invoices} payments={payments} persistenceStatus="local" />);

    fireEvent.change(screen.getByLabelText("Apply amount to INV-1001"), { target: { value: "55.00" } });
    fireEvent.change(screen.getByLabelText("Apply amount to INV-1002"), { target: { value: "45.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm application" }));

    await waitFor(() => expect(window.localStorage.getItem("ir_decisions_demo_v1")).not.toBeNull());
    const stored = JSON.parse(window.localStorage.getItem("ir_decisions_demo_v1") || "{}") as Record<string, unknown>;
    expect(stored).toMatchObject({
      "match-one": {
        outcome: "confirmed",
        invoiceIds: ["invoice-one", "invoice-two"],
        allocations: [
          { invoiceId: "invoice-one", amountMinor: 5_500 },
          { invoiceId: "invoice-two", amountMinor: 4_500 },
        ],
        appliedAmountMinor: 10_000,
      },
    });
    expect(sendAnalyticsEvent).toHaveBeenNthCalledWith(1, "exception_reviewed", { result: "confirmed", source: "in_app" });
    expect(sendAnalyticsEvent).toHaveBeenNthCalledWith(2, "match_confirmed", { result: "confirmed", source: "in_app" });
    expect(sendAnalyticsEvent).toHaveBeenCalledTimes(2);
  });

  it("blocks an allocation above an invoice balance", () => {
    render(<ReviewQueue workspaceId="demo" matches={matches} invoices={invoices} payments={payments} persistenceStatus="local" />);

    fireEvent.change(screen.getByLabelText("Apply amount to INV-1001"), { target: { value: "60.01" } });
    expect(screen.getByText("The allocation for this invoice exceeds its outstanding balance.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm application" })).toBeDisabled();
  });

  it("mounts only one bounded page for a 10,000-item review queue", () => {
    const largePayments = Array.from({ length: 10_000 }, (_, index): Payment => ({
      ...payments[0],
      id: `payment-${index + 1}`,
      payerName: `Payer ${index + 1}`,
      transactionId: `BANK-${index + 1}`,
    }));
    const largeMatches = Array.from({ length: 10_000 }, (_, index): ProposedMatch => ({
      ...matches[0],
      id: `match-${index + 1}`,
      paymentIds: [`payment-${index + 1}`],
    }));

    render(<ReviewQueue workspaceId="demo" matches={largeMatches} invoices={invoices} payments={largePayments} persistenceStatus="local" />);

    expect(screen.getAllByTestId("review-queue-item")).toHaveLength(50);
    expect(screen.getByText("Page 1 of 200")).toBeInTheDocument();
    expect(screen.queryByText("Payer 51")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next queue page" }));
    expect(screen.getAllByTestId("review-queue-item")).toHaveLength(50);
    expect(screen.getByText("Payer 51")).toBeInTheDocument();
    expect(screen.queryByText("Payer 101")).not.toBeInTheDocument();
  });
});
