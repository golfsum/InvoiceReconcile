const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLIC_ANALYTICS_PATHS = new Set([
  "/",
  "/accounts-receivable-reconciliation",
  "/bank-deposit-to-invoice-matching",
  "/cash-application-automation",
  "/combined-payment-invoice-matching",
  "/contact",
  "/excel-invoice-reconciliation",
  "/industries",
  "/invoice-payment-matching",
  "/invoice-reconciliation-for-bookkeepers",
  "/invoice-reconciliation-software",
  "/partial-payment-reconciliation",
  "/payment-reconciliation-for-accounting-firms",
  "/payment-reconciliation-for-small-business",
  "/payment-reconciliation-software",
  "/pricing",
  "/privacy",
  "/product",
  "/quickbooks-invoice-reconciliation",
  "/quickbooks-payment-matching",
  "/resources",
  "/security",
  "/solutions",
  "/terms",
  "/tools",
]);

const PUBLIC_ANALYTICS_PREFIXES = [
  "/compare/",
  "/industries/",
  "/resources/",
  "/solutions/",
  "/tools/",
];

function canonicalPath(pathname: string) {
  const queryIndex = pathname.search(/[?#]/);
  const withoutQuery = queryIndex >= 0 ? pathname.slice(0, queryIndex) : pathname;
  if (!withoutQuery.startsWith("/") || withoutQuery.startsWith("//")) return "/unknown";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : "/";
}

export function isPublicAnalyticsPath(pathname: string) {
  const path = canonicalPath(pathname);
  return PUBLIC_ANALYTICS_PATHS.has(path)
    || PUBLIC_ANALYTICS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function analyticsPathTemplate(pathname: string) {
  const path = canonicalPath(pathname);
  const segments = path.split("/");
  return segments.map((segment, index) => {
    if (!UUID_SEGMENT.test(segment)) return segment;
    const previous = segments[index - 1];
    if (previous === "app" || previous === "workspaces") return ":workspaceId";
    if (previous === "organizations") return ":organizationId";
    if (previous === "sources") return ":sourceId";
    if (previous === "async") return ":requestId";
    return ":id";
  }).join("/");
}
