import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { privacyContent } from "@/content/legal";
import { canonicalMetadata } from "@/content/seo/seo-components";

export const metadata: Metadata = canonicalMetadata(privacyContent.title, privacyContent.seoDescription, "/privacy");
export default function PrivacyPage() { return <LegalPage document={privacyContent} />; }
