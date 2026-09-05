import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { siteConfig } from "@/lib/config";

const groups = [
  {
    title: "Product",
    links: [
      ["Product", "/product"],
      ["Pricing", "/pricing"],
      ["Security", "/security"],
      ["Sign in", "/auth/sign-in"],
    ],
  },
  {
    title: "Solutions",
    links: [
      ["Bookkeepers", "/solutions/bookkeepers"],
      ["Accounting firms", "/solutions/accounting-firms"],
      ["Small business", "/solutions/small-business"],
      ["Excel workflows", "/excel-invoice-reconciliation"],
    ],
  },
  {
    title: "Tools",
    links: [
      ["Lump-sum matcher", "/tools/lump-sum-invoice-matcher"],
      ["Payment matcher", "/tools/invoice-payment-matcher"],
      ["Time calculator", "/tools/reconciliation-time-calculator"],
      ["Sample CSV files", "/excel-invoice-reconciliation"],
    ],
  },
  {
    title: "Company",
    links: [
      ["Resources", "/resources"],
      ["Contact", "/contact"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="page-shell grid gap-10 py-14 lg:grid-cols-[1.35fr_3fr]">
        <div>
          <BrandLogo />
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted">
            Incoming payment reconciliation for teams that want evidence, exceptions, and control.
          </p>
          <a className="mt-4 inline-block text-sm font-semibold text-brand hover:underline" href={`mailto:${siteConfig.supportEmail}`}>
            {siteConfig.supportEmail}
          </a>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-bold uppercase tracking-[0.1em] text-muted">{group.title}</h2>
              <ul className="mt-4 space-y-3">
                {group.links.map(([label, href]) => (
                  <li key={href}>
                    <Link className="text-sm text-muted-strong hover:text-foreground" href={href}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t">
        <div className="page-shell flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} InvoiceReconcile. All rights reserved.</p>
          <p>Suggestions require review before posting or export.</p>
        </div>
      </div>
    </footer>
  );
}
