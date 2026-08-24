import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap border px-4 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-brand bg-brand text-white shadow-sm hover:bg-brand-hover dark:text-[#10241b]",
        secondary: "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
        quiet: "border-transparent bg-transparent text-muted-strong hover:bg-surface-muted hover:text-foreground",
        danger: "border-danger bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "min-h-8 px-3 text-xs",
        md: "min-h-10 px-4",
        lg: "min-h-12 px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
