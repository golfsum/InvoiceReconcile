import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AudienceLandingPage, canonicalMetadata } from "@/content/seo/seo-components";
import { solutionPages, solutionSlugs } from "@/content/seo/solutions";

export const dynamicParams = false;

export function generateStaticParams() {
  return solutionSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = solutionPages[slug];
  if (!page) return {};
  return canonicalMetadata(page.metaTitle, page.description, `/solutions/${slug}`);
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = solutionPages[slug];
  if (!page) notFound();
  return <AudienceLandingPage page={page} section="Solutions" />;
}
