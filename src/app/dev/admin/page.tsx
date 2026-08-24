import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Local admin access", robots: { index: false, follow: false } };

export default function LocalAdminAccessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <main className="grid min-h-screen place-items-center bg-background p-6"><section className="w-full max-w-lg border bg-surface p-8"><BrandLogo /><ShieldCheck className="mt-10 size-8 text-brand" /><p className="eyebrow mt-5">Development only</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Open the internal dashboard</h1><p className="mt-3 text-sm leading-6 text-muted">This creates a signed, local-only administrator session and redirects to the fictional admin dataset. Production always returns a 404 for this route.</p><form className="mt-6" action="/api/demo/session" method="post"><input type="hidden" name="role" value="admin" /><input type="hidden" name="returnTo" value="/admin" /><Button size="lg" type="submit">Continue as local admin</Button></form></section></main>;
}
