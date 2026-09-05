"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { BrandLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/product", label: "Product" },
  { href: "/solutions/bookkeepers", label: "Solutions" },
  { href: "/resources", label: "Resources" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      <div className="page-shell flex h-16 items-center justify-between gap-5">
        <BrandLogo />
        <nav aria-label="Primary navigation" className="hidden items-center gap-1 lg:flex">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="px-3 py-2 text-sm font-medium text-muted-strong hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle />
          <Link href="/auth/sign-in" className={buttonVariants({ variant: "quiet", size: "sm" })}>
            Sign in
          </Link>
          <Link href="/auth/sign-up" className={buttonVariants({ variant: "primary", size: "sm" })}>
            Start free
          </Link>
        </div>
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center border bg-surface lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <div id="mobile-navigation" className={cn("border-t bg-background lg:hidden", open ? "block" : "hidden")}>
        <nav aria-label="Mobile navigation" className="page-shell flex flex-col py-4">
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="border-b py-3 text-sm font-semibold" onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <div className="mt-4 grid grid-cols-[auto_1fr_1fr] gap-2">
            <ThemeToggle className="size-10" />
            <Link href="/auth/sign-in" className={buttonVariants({ variant: "secondary" })} onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link href="/auth/sign-up" className={buttonVariants({ variant: "primary" })} onClick={() => setOpen(false)}>
              Start free
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
