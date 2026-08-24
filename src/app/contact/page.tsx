import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { contactContent } from "@/content/legal";
import { canonicalMetadata } from "@/content/seo/seo-components";

export const metadata: Metadata = canonicalMetadata(contactContent.title, contactContent.seoDescription, "/contact");
export default function ContactPage() { return <LegalPage document={contactContent} />; }
