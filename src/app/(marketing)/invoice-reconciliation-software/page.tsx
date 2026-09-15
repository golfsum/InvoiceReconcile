import { landingPages } from "@/content/seo/landing-pages";
import { canonicalMetadata, SeoLandingPage } from "@/content/seo/seo-components";

const basePage = landingPages["invoice-reconciliation-software"];
const page = {
  ...basePage,
  title: "Invoice reconciliation software for bookkeepers and AR teams",
  metaTitle: "Invoice Reconciliation Software for AR & Bookkeepers | InvoiceReconcile",
  description:
    "Match incoming payments to open invoices, review partial and combined payments, investigate discrepancies, and export a clear audit trail. Start with CSV or Excel files.",
  intro:
    "InvoiceReconcile turns the invoice and payment files you already receive into a repeatable reconciliation workflow. Import CSV or Excel, review suggested one-to-one and combined matches, keep exceptions visible, and export only the results a person has confirmed.",
  audience:
    "Bookkeepers, accounting firms, and small finance teams that reconcile incoming customer payments every week or month.",
  cta: "Upload invoice and payment files free",
};

export const metadata = canonicalMetadata(page.metaTitle, page.description, `/${page.slug}`);
export default function Page() { return <SeoLandingPage page={page} />; }
