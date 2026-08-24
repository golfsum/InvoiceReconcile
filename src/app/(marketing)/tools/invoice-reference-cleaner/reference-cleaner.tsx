"use client";

import { useMemo, useState } from "react";
import { Check, Copy, TextCursorInput } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cleanInvoiceReference } from "@/content/seo/tools";
import { fieldClass } from "../_components/tool-shell";

export function ReferenceCleaner() {
  const [input, setInput] = useState("invoice # 10487\nINV  10491\nInv.No: 105-02\npo / west 44");
  const [copied, setCopied] = useState(false);
  const results = useMemo(() => input.split(/\r?\n/).filter((line) => line.trim()).slice(0, 100).map((original) => ({ original, cleaned: cleanInvoiceReference(original) })), [input]);
  const output = results.map((result) => result.cleaned).join("\n");

  async function copy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="border bg-surface p-6"><label className="text-sm font-semibold" htmlFor="reference-input">Invoice references, one per line</label><p className="mt-1 text-xs leading-5 text-muted">Maximum 100 lines. The cleaner standardizes case, whitespace, punctuation, and common invoice labels.</p><textarea className={`${fieldClass} min-h-72 resize-y font-mono leading-6`} id="reference-input" value={input} onChange={(event) => { setInput(event.target.value); setCopied(false); }} spellCheck={false} /><div className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted"><TextCursorInput className="mt-0.5 size-3.5 shrink-0 text-brand" /><p>Cleaning creates comparison keys. Always retain the original reference in financial records.</p></div></div>
      <section className="border bg-surface" aria-live="polite" aria-labelledby="cleaned-reference-title"><div className="flex items-center justify-between gap-4 border-b px-6 py-4"><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">Output</p><h2 className="mt-1 text-xl font-semibold" id="cleaned-reference-title">Cleaned references</h2></div><button className={buttonVariants({ variant: "secondary", size: "sm" })} type="button" onClick={copy} disabled={!output}>{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy all"}</button></div><div className="p-6">{results.length ? <div className="overflow-x-auto border"><table className="w-full min-w-[480px] text-left text-sm"><thead className="bg-surface-muted"><tr><th className="border-b px-4 py-3">Original</th><th className="border-b px-4 py-3">Cleaned comparison key</th></tr></thead><tbody className="divide-y">{results.map((result, index) => <tr key={`${result.original}-${index}`}><td className="px-4 py-3 font-mono text-muted-strong">{result.original}</td><td className="px-4 py-3 font-mono font-semibold">{result.cleaned || "No usable characters"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">Enter a reference to create a cleaned comparison key.</p>}<p className="mt-4 text-sm leading-6 text-muted">Normalization can make formatting variations comparable. It cannot prove that two references identify the same invoice.</p></div></section>
    </div>
  );
}
