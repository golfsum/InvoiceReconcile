import { performance } from "node:perf_hooks";
import {
  reconcile,
  type Invoice,
  type Payment,
} from "../src/lib/reconciliation/index";

const RELEASE_BUDGET_MILLISECONDS = 30_000;

function createFixture(size: number): { invoices: Invoice[]; payments: Payment[] } {
  const invoices = Array.from({ length: size }, (_, index): Invoice => {
    const suffix = String(index).padStart(5, "0");
    const amountMinor = 100_000 + index;
    return {
      id: `benchmark-invoice-${suffix}`,
      invoiceNumber: `BENCH-${suffix}`,
      customerName: `Benchmark Customer ${suffix}`,
      customerId: `BENCH-CUSTOMER-${suffix}`,
      invoiceDate: "2026-06-01",
      originalAmountMinor: amountMinor,
      outstandingAmountMinor: amountMinor,
      currency: "USD",
      status: "open",
    };
  });
  const payments = Array.from({ length: size }, (_, index): Payment => {
    const suffix = String(index).padStart(5, "0");
    return {
      id: `benchmark-payment-${suffix}`,
      paymentDate: "2026-06-05",
      amountMinor: 100_000 + index,
      currency: "USD",
      payerName: `Benchmark Customer ${suffix}`,
      payerId: `BENCH-CUSTOMER-${suffix}`,
      description: `Payment for BENCH-${suffix}`,
      transactionId: `BENCH-TXN-${suffix}`,
    };
  });
  return { invoices, payments };
}

function requestedSizes(): number[] {
  const parsed = process.argv.slice(2)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return parsed.length > 0 ? parsed : [1_000, 5_000];
}

const warmup = createFixture(100);
reconcile(warmup.invoices, warmup.payments);

let releaseBudgetFailed = false;
for (const size of requestedSizes()) {
  const fixture = createFixture(size);
  const startedAt = performance.now();
  const result = reconcile(fixture.invoices, fixture.payments);
  const elapsedMilliseconds = performance.now() - startedAt;
  const applied = result.matches.filter((match) => match.appliedAmountMinor > 0).length;
  console.log(JSON.stringify({
    invoices: size,
    payments: size,
    elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(1)),
    matches: result.matches.length,
    applied,
    review: result.matches.length - applied,
  }));
  if (size >= 5_000 && elapsedMilliseconds >= RELEASE_BUDGET_MILLISECONDS) {
    releaseBudgetFailed = true;
  }
}

if (releaseBudgetFailed) {
  console.error(`The 5,000 by 5,000 benchmark exceeded ${RELEASE_BUDGET_MILLISECONDS} ms.`);
  process.exitCode = 1;
}
