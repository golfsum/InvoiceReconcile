export const siteConfig = {
  name: "InvoiceReconcile",
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || "InvoiceReconcile",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://invoicereconcile.com",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@invoicereconcile.com",
  description:
    "Incoming payment reconciliation for bookkeepers, accounting firms, and small finance teams.",
} as const;

export const plans = [
  {
    key: "free",
    name: "Free",
    price: 0,
    paymentLimit: 50,
    description: "Test a real reconciliation workflow without a card.",
    features: ["1 workspace", "CSV and XLSX import", "Matching and exception review", "Reconciliation history", "CSV and XLSX export"],
  },
  {
    key: "solo",
    name: "Solo",
    price: 19,
    paymentLimit: 500,
    description: "For one business with recurring reconciliation work.",
    features: ["1 workspace", "Saved column mappings", "Workspace payer rules", "Audit and reconciliation history", "CSV and XLSX exports", "Email support"],
    priceEnv: "STRIPE_PRICE_SOLO",
  },
  {
    key: "business",
    name: "Business",
    price: 49,
    paymentLimit: 2500,
    description: "For a finance team processing a higher monthly volume.",
    features: ["Up to 3 workspaces", "Colleague invitations", "Payer, description, reference, and fee-review rules", "Audit and reconciliation history", "CSV and XLSX exports", "Priority email support"],
    priceEnv: "STRIPE_PRICE_BUSINESS",
    highlighted: true,
  },
  {
    key: "bookkeeper",
    name: "Bookkeeper",
    price: 99,
    paymentLimit: 10000,
    description: "For bookkeeping firms with substantial reconciliation volume.",
    features: ["Up to 20 client workspaces", "Portfolio status dashboard", "Colleague invitations", "Client-specific custom matching rules", "Audit and reconciliation history", "CSV and XLSX exports", "Priority email support"],
    priceEnv: "STRIPE_PRICE_BOOKKEEPER",
  },
] as const;

export type PlanKey = (typeof plans)[number]["key"];
