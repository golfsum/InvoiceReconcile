import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-7", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="4" fill="currentColor" className="text-[#173d2e] dark:text-[#75c9a3]" />
      <path d="M7 10H17.5L20 12.5H25" stroke="white" strokeWidth="2" strokeLinecap="square" />
      <path d="M7 21.5H12L14.5 19H25" stroke="#A7E1C4" strokeWidth="2" strokeLinecap="square" />
      <path d="M8 15.75H24" stroke="white" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function BrandLogo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5 text-foreground", className)} aria-label="InvoiceReconcile home">
      <LogoMark />
      {compact ? null : <span className="text-[15px] font-bold tracking-[-0.025em] sm:text-base">InvoiceReconcile</span>}
    </Link>
  );
}
