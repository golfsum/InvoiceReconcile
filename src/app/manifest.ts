import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InvoiceReconcile",
    short_name: "InvoiceReconcile",
    description: "Match incoming payments to open invoices and review the exceptions.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#176b4d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
