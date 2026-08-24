"use client";

import { useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendAnalyticsEvent } from "@/components/analytics/analytics-provider";

type FormStatus = { kind: "idle" | "sending" | "sent" | "error"; message?: string };

export function ContactForm() {
  const [status, setStatus] = useState<FormStatus>({ kind: "idle" });

  async function submit(formData: FormData) {
    setStatus({ kind: "sending" });
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          subject: formData.get("topic"),
          message: formData.get("message"),
          companyWebsite: formData.get("companyWebsite"),
          sourcePath: window.location.pathname,
        }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "We could not send your request.");
      sendAnalyticsEvent("contact_submitted", { source: "direct", result: "success" });
      setStatus({ kind: "sent", message: result.message || "Your request was sent." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "We could not send your request." });
    }
  }

  return (
    <section className="mt-4 border bg-surface p-6 sm:p-8" aria-labelledby="contact-form-heading">
      <p className="eyebrow">Send a request</p>
      <h2 id="contact-form-heading" className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Tell us what you need</h2>
      <p className="mt-2 text-sm leading-6 text-muted">We will route your message to product, billing, privacy, or security support. Do not include passwords or unredacted financial files.</p>
      {status.kind === "sent" ? (
        <div className="mt-6 flex gap-3 border border-success/25 bg-success-soft p-4 text-success" role="status">
          <Check className="mt-0.5 size-5 shrink-0" /><p className="text-sm font-medium">{status.message}</p>
        </div>
      ) : (
        <form className="mt-6 grid gap-4" action={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Name<input className="mt-1.5 min-h-11 w-full border bg-background px-3 font-normal outline-none focus:border-brand" name="name" autoComplete="name" required maxLength={120} /></label>
            <label className="text-sm font-semibold">Work email<input className="mt-1.5 min-h-11 w-full border bg-background px-3 font-normal outline-none focus:border-brand" type="email" name="email" autoComplete="email" required maxLength={254} /></label>
          </div>
          <label className="text-sm font-semibold">Topic<select className="mt-1.5 min-h-11 w-full border bg-background px-3 font-normal outline-none focus:border-brand" name="topic" defaultValue="product"><option value="product">Product or import help</option><option value="account">Account access</option><option value="billing">Billing or cancellation</option><option value="privacy">Privacy request</option><option value="security">Security report</option><option value="legal">Legal notice</option></select></label>
          <label className="text-sm font-semibold">Message<textarea className="mt-1.5 min-h-36 w-full resize-y border bg-background p-3 font-normal leading-6 outline-none focus:border-brand" name="message" required minLength={10} maxLength={5000} /></label>
          <input className="hidden" tabIndex={-1} autoComplete="off" name="companyWebsite" aria-hidden="true" />
          {status.kind === "error" ? <p className="border border-danger/25 bg-danger-soft p-3 text-sm text-danger" role="alert">{status.message} You can also email support@invoicereconcile.com.</p> : null}
          <Button className="w-fit" type="submit" size="lg" disabled={status.kind === "sending"}>{status.kind === "sending" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{status.kind === "sending" ? "Sending" : "Send to support"}</Button>
        </form>
      )}
    </section>
  );
}
