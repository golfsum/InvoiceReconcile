"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Route rendering failed", error.digest || error.message); }, [error]);
  return <main className="grid min-h-screen place-items-center bg-background p-6"><div className="w-full max-w-lg border bg-surface p-8 text-center"><AlertTriangle className="mx-auto size-8 text-danger" /><h1 className="mt-5 text-2xl font-semibold">This view could not be loaded.</h1><p className="mt-3 text-sm leading-6 text-muted">No reconciliation decision was changed. Try the view again, or contact support@invoicereconcile.com if the problem continues.</p><Button className="mt-6" onClick={reset}><RotateCcw className="size-4" />Try again</Button></div></main>;
}
