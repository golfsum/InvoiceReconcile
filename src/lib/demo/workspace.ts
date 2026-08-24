import { northstarDemoFixture, reconcile } from "@/lib/reconciliation";

export const demoWorkspace = {
  id: "demo",
  name: northstarDemoFixture.companyName,
  firmName: "Ledgerline Bookkeeping",
  notice: northstarDemoFixture.notice,
  invoices: [...northstarDemoFixture.invoices],
  payments: [...northstarDemoFixture.payments],
  result: reconcile([...northstarDemoFixture.invoices], [...northstarDemoFixture.payments]),
};

export const demoClients = [
  { id: "demo", name: "Northstar Services", imported: 22, matched: 16, review: 6, lastReconciled: "Today" },
  { id: "acme-plumbing", name: "Acme Plumbing", imported: 218, matched: 207, review: 11, lastReconciled: "Today" },
  { id: "smith-electric", name: "Smith Electric", imported: 84, matched: 84, review: 0, lastReconciled: "Today" },
  { id: "bright-dental", name: "Bright Dental", imported: 131, matched: 124, review: 7, lastReconciled: "Yesterday" },
] as const;

export function money(minor: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
