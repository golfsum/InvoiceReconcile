import { landingPages } from "@/content/seo/landing-pages";
import { canonicalMetadata, SeoLandingPage } from "@/content/seo/seo-components";

const page = landingPages["combined-payment-invoice-matching"];
export const metadata = canonicalMetadata(page.metaTitle, page.description, `/${page.slug}`);
export default function Page() { return <SeoLandingPage page={page} />; }
