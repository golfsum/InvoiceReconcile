import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { termsContent } from "@/content/legal";
import { canonicalMetadata } from "@/content/seo/seo-components";

export const metadata: Metadata = canonicalMetadata(termsContent.title, termsContent.seoDescription, "/terms");
export default function TermsPage() { return <LegalPage document={termsContent} />; }
