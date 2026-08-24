import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { industryPages, industrySlugs } from "@/content/seo/industries";
import { AudienceLandingPage, canonicalMetadata } from "@/content/seo/seo-components";

export const dynamicParams = false;

export function generateStaticParams() {
  return industrySlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = industryPages[slug];
  if (!page) return {};
  return canonicalMetadata(page.metaTitle, page.description, `/industries/${slug}`);
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = industryPages[slug];
  if (!page) notFound();
  return <AudienceLandingPage page={page} section="Industries" />;
}
