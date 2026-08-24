import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { MarketingFrame } from "@/components/marketing/marketing-frame";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return <MarketingFrame><section className="page-shell grid min-h-[62vh] place-items-center py-20 text-center"><div><FileQuestion className="mx-auto size-9 text-brand" /><p className="eyebrow mt-6">404</p><h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">This record is not here.</h1><p className="mx-auto mt-4 max-w-lg text-base leading-7 text-muted">The page may have moved, or the link may point to a workspace you cannot access.</p><Link className={`${buttonVariants({ variant: "secondary" })} mt-7`} href="/"><ArrowLeft className="size-4" />Return home</Link></div></section></MarketingFrame>;
}
