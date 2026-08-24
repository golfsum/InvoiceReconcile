import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { securityContent } from "@/content/legal";
import { canonicalMetadata } from "@/content/seo/seo-components";

export const metadata: Metadata = canonicalMetadata(securityContent.title, securityContent.seoDescription, "/security");
export default function SecurityPage() { return <LegalPage document={securityContent} />; }
