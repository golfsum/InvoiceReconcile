"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WorkspaceDataUnavailable() {
  const router = useRouter();
  return <div className="mx-auto max-w-3xl border border-warning/25 bg-warning-soft p-8 text-center"><h1 className="text-2xl font-semibold">Saved reconciliation data is unavailable</h1><p className="mt-2 text-sm text-muted">The workspace is still protected. No demo records have been substituted. Retry when the connection or data service is available.</p><Button className="mt-5" variant="secondary" onClick={() => router.refresh()}><RefreshCw className="size-4" /> Try again</Button></div>;
}
