import { AlertTriangle, Check, CircleHelp, CircleOff, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "exact" | "high" | "review" | "unmatched" | "duplicate" | "error";

const styles: Record<Status, string> = {
  exact: "border-success/25 bg-success-soft text-success",
  high: "border-success/25 bg-success-soft text-success",
  review: "border-warning/25 bg-warning-soft text-warning",
  unmatched: "border-border-strong bg-surface-muted text-muted-strong",
  duplicate: "border-info/25 bg-info-soft text-info",
  error: "border-danger/25 bg-danger-soft text-danger",
};

const icons = {
  exact: Check,
  high: Check,
  review: AlertTriangle,
  unmatched: CircleOff,
  duplicate: Copy,
  error: CircleHelp,
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const Icon = icons[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 border px-2 py-1 text-xs font-semibold", styles[status], className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {label || status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
