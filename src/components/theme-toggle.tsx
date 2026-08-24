"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);

  const order = ["light", "dark", "system"] as const;
  const current = mounted && order.includes(theme as (typeof order)[number]) ? theme : "system";
  const next = order[(order.indexOf(current as (typeof order)[number]) + 1) % order.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      className={cn("inline-flex size-9 items-center justify-center border bg-surface text-muted transition hover:text-foreground", className)}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      title={`Theme: ${current}`}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
