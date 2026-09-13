import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "@/content/seo/seo-components";
import { resourceBySlug, resourceSlugs } from "@/content/seo/resources";
import { ResourceArticlePage } from "../_components/article-page";

export const dynamicParams = false;

export function generateStaticParams() {
  return resourceSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = resourceBySlug[slug];
  if (!article) return {};
  const searchTitles: Record<string, string> = {
    "accounts-receivable-reconciliation-explained": "Accounts Receivable Reconciliation Guide",
    "cash-application-explained-for-small-businesses": "Cash Application: Process & Examples",
  };
  const title = searchTitles[slug] ?? article.title;
  return canonicalMetadata(`${title} | InvoiceReconcile`, article.description, `/resources/${slug}`);
}

export default async function ResourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = resourceBySlug[slug];
  if (!article) notFound();
  return <ResourceArticlePage article={article} />;
}
