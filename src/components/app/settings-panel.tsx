"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { CreditCard, Download, LoaderCircle, Plug, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteWorkspaceAction, updateImportEmailPreferenceAction, updateWorkspaceSettingsAction } from "@/app/app/workspaces/actions";
import { Button } from "@/components/ui/button";
import { TeamPanel, type OrganizationTeamMember } from "@/components/app/team-panel";
import { demoWorkspace } from "@/lib/demo/workspace";
import { siteConfig } from "@/lib/config";
import { downloadWorkspaceArchive } from "@/lib/reconciliation/browser-export";

const commonCurrencies = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
const commonTimezones = ["America/Phoenix", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "UTC"] as const;

export type LiveWorkspaceSettings = {
  businessName: string;
  currency: string;
  timezone: string;
  accountingBasis: "cash" | "accrual";
  matchDaysAfter: number;
};

function SaveSettingsButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{pending ? "Saving settings" : "Save settings"}</Button>;
}

function DeleteWorkspaceButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="danger" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{pending ? "Deleting workspace" : "Delete workspace"}</Button>;
}

export function SettingsPanel({ isDemo, workspaceId, organizationId, initialSettings, initialTransactionalImportEmails = null, canEdit = false, canDelete = false, teamMembers = null, teamPlanEligible = false }: { isDemo: boolean; workspaceId?: string; organizationId?: string; initialSettings?: LiveWorkspaceSettings; initialTransactionalImportEmails?: boolean | null; canEdit?: boolean; canDelete?: boolean; teamMembers?: OrganizationTeamMember[] | null; teamPlanEligible?: boolean }) {
  const [businessName, setBusinessName] = useState("Northstar Services");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("America/Phoenix");
  const [dateWindow, setDateWindow] = useState(90);
  const [confirmText, setConfirmText] = useState("");
  const [sourceDeleted, setSourceDeleted] = useState(false);

  useEffect(() => {
    let restoreTimer: number | undefined;
    try {
      const raw = window.localStorage.getItem("ir_demo_workspace_settings_v1");
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, unknown>;
      const savedBusinessName = typeof saved.businessName === "string" && saved.businessName.trim().length >= 2 && saved.businessName.trim().length <= 200
        ? saved.businessName.trim()
        : null;
      const savedCurrency = typeof saved.currency === "string" && commonCurrencies.includes(saved.currency as (typeof commonCurrencies)[number])
        ? saved.currency
        : null;
      const savedTimezone = typeof saved.timezone === "string" && commonTimezones.includes(saved.timezone as (typeof commonTimezones)[number])
        ? saved.timezone
        : null;
      const savedDateWindow = typeof saved.dateWindow === "number" && Number.isInteger(saved.dateWindow) && saved.dateWindow >= 1 && saved.dateWindow <= 365
        ? saved.dateWindow
        : null;
      restoreTimer = window.setTimeout(() => {
        if (savedBusinessName) setBusinessName(savedBusinessName);
        if (savedCurrency) setCurrency(savedCurrency);
        if (savedTimezone) setTimezone(savedTimezone);
        if (savedDateWindow !== null) setDateWindow(savedDateWindow);
      }, 0);
    } catch {
      // Storage can be blocked or contain older invalid demo state. Keep defaults.
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, []);

  function save() {
    const normalizedBusinessName = businessName.trim();
    if (normalizedBusinessName.length < 2 || normalizedBusinessName.length > 200) {
      toast.error("Enter a business name between 2 and 200 characters.");
      return;
    }
    if (!Number.isInteger(dateWindow) || dateWindow < 1 || dateWindow > 365) {
      toast.error("Enter a matching date window from 1 to 365 days.");
      return;
    }
    try {
      window.localStorage.setItem("ir_demo_workspace_settings_v1", JSON.stringify({ businessName: normalizedBusinessName, currency, timezone, dateWindow }));
      setBusinessName(normalizedBusinessName);
      setSourceDeleted(false);
      toast.success("Workspace settings saved");
    } catch {
      toast.error("This browser could not save the demo settings.");
    }
  }

  function exportData() {
    const payload = JSON.stringify({ workspace: { id: demoWorkspace.id, businessName, currency, timezone, dateWindow }, invoices: demoWorkspace.invoices, payments: demoWorkspace.payments, matches: demoWorkspace.result.matches }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "northstar-workspace-export.json"; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success("Workspace data exported");
  }

  function deleteWorkspace() {
    if (confirmText !== "DELETE") { toast.error("Type DELETE exactly to confirm."); return; }
    ["ir_demo_workspace_settings_v1", "ir_demo_rules_v1", "ir_demo_decisions_v1"].forEach((key) => window.localStorage.removeItem(key));
    setConfirmText(""); toast.success("Local demo workspace data cleared", { description: "The original fictional fixture remains available when you reload." });
  }

  if (!isDemo) {
    if (!workspaceId || !organizationId || !initialSettings) return <div className="border border-warning/30 bg-warning-soft p-4 text-sm text-warning" role="alert">Workspace settings are temporarily unavailable. Return to client workspaces and try again.</div>;
    return <LiveSettings workspaceId={workspaceId} organizationId={organizationId} initialSettings={initialSettings} initialTransactionalImportEmails={initialTransactionalImportEmails} canEdit={canEdit} canDelete={canDelete} teamMembers={teamMembers} teamPlanEligible={teamPlanEligible} />;
  }

  return <div className="mx-auto max-w-4xl"><div><p className="eyebrow">Demo settings</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Fictional workspace settings</h1><p className="mt-2 text-sm text-muted">Try settings with Northstar Services data. Changes stay in this browser and do not affect a live account.</p></div>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">General</h2></div><div className="grid gap-5 p-5 sm:grid-cols-2"><label className="text-sm font-semibold">Business name<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={businessName} minLength={2} maxLength={200} onChange={(event) => setBusinessName(event.target.value)} /></label><label className="text-sm font-semibold">Currency<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={currency} onChange={(event) => setCurrency(event.target.value)}>{commonCurrencies.map((code) => <option key={code}>{code}</option>)}</select></label><label className="text-sm font-semibold">Timezone<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={timezone} onChange={(event) => setTimezone(event.target.value)}>{commonTimezones.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label className="text-sm font-semibold">Default matching date window<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" type="number" min="1" max="365" value={dateWindow} onChange={(event) => setDateWindow(Number(event.target.value))} /><span className="mt-1 block text-xs font-normal text-muted">Days after the invoice date.</span></label></div><div className="border-t p-5"><Button type="button" onClick={save}><Save className="size-4" /> Save settings</Button></div></section>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Demo data</h2><p className="mt-1 text-sm text-muted">Export the fictional fixture or clear changes saved by this browser.</p></div><div className="divide-y"><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">Export fictional workspace data</h3><p className="mt-1 text-sm text-muted">Download the Northstar invoices, payments, matches, and sample settings as JSON.</p></div><Button variant="secondary" onClick={exportData}><Download className="size-4" /> Export demo data</Button></div><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">Clear browser-saved demo changes</h3><p className="mt-1 text-sm text-muted">Remove local sample settings, rules, and decisions. The original fixture remains available.</p></div><Button variant="secondary" disabled={sourceDeleted} onClick={() => { ["ir_demo_workspace_settings_v1", "ir_demo_rules_v1", "ir_demo_decisions_v1"].forEach((key) => window.localStorage.removeItem(key)); setSourceDeleted(true); toast.success("Browser-saved demo changes cleared"); }}><Trash2 className="size-4" /> {sourceDeleted ? "Demo changes cleared" : "Clear demo changes"}</Button></div></div></section>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Connections and billing</h2><p className="mt-1 text-sm text-muted">Connections show their real configuration state. No provider is presented as live before OAuth credentials and authorization exist.</p></div><div className="divide-y"><div className="grid gap-px bg-border sm:grid-cols-5">{["QuickBooks", "Xero", "Plaid", "Stripe", "Square"].map((provider) => <div className="bg-surface p-4" key={provider}><div className="flex items-center gap-2"><Plug className="size-4 text-muted" /><span className="text-sm font-semibold">{provider}</span></div><span className="mt-3 inline-block border bg-surface-muted px-2 py-1 text-xs font-semibold text-muted">Not connected</span></div>)}</div><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">Plan and payment method</h3><p className="mt-1 text-sm text-muted">Choose a plan or open Stripe-hosted subscription controls.</p></div><Link className="inline-flex min-h-10 items-center justify-center gap-2 border border-brand bg-brand px-4 text-sm font-semibold text-white" href="/settings/billing"><CreditCard className="size-4" />Open billing</Link></div></div></section>
    <section className="mt-6 border border-danger/30 bg-surface"><div className="border-b border-danger/20 p-5"><h2 className="font-semibold text-danger">Reset demo changes</h2><p className="mt-1 text-sm text-muted">This clears only sample changes stored on this device. It does not delete an account or server record.</p></div><div className="p-5"><label className="text-sm font-semibold">Type DELETE to confirm<input className="mt-1.5 h-10 w-full max-w-sm border bg-background px-3 font-normal" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} /></label><div><Button className="mt-4" variant="danger" onClick={deleteWorkspace}><Trash2 className="size-4" /> Reset local demo data</Button></div></div></section>
  </div>;
}

function LiveSettings({ workspaceId, organizationId, initialSettings, initialTransactionalImportEmails, canEdit, canDelete, teamMembers, teamPlanEligible }: { workspaceId: string; organizationId: string; initialSettings: LiveWorkspaceSettings; initialTransactionalImportEmails: boolean | null; canEdit: boolean; canDelete: boolean; teamMembers: OrganizationTeamMember[] | null; teamPlanEligible: boolean }) {
  const [settingsState, settingsAction] = useActionState(updateWorkspaceSettingsAction, {});
  const [emailState, emailAction] = useActionState(updateImportEmailPreferenceAction, {});
  const [deleteState, deleteAction] = useActionState(deleteWorkspaceAction, {});
  const [exporting, setExporting] = useState(false);
  const [importEmails, setImportEmails] = useState(initialTransactionalImportEmails ?? true);
  const input = "mt-1.5 h-10 w-full border bg-background px-3 font-normal disabled:cursor-not-allowed disabled:opacity-60";
  const currencyOptions = commonCurrencies.includes(initialSettings.currency as (typeof commonCurrencies)[number])
    ? [...commonCurrencies]
    : [initialSettings.currency, ...commonCurrencies];
  const timezoneOptions = commonTimezones.includes(initialSettings.timezone as (typeof commonTimezones)[number])
    ? [...commonTimezones]
    : [initialSettings.timezone, ...commonTimezones];

  async function exportArchive() {
    setExporting(true);
    try {
      await downloadWorkspaceArchive(workspaceId, initialSettings.businessName);
      toast.success("Workspace archive downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The workspace archive could not be created.");
    } finally {
      setExporting(false);
    }
  }

  return <div className="mx-auto max-w-4xl"><div><p className="eyebrow">Settings</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Workspace and data controls</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Manage matching defaults, billing, workspace data access, and deletion.</p></div>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Workspace defaults</h2><p className="mt-1 text-sm text-muted">Changes apply to future imports and do not rewrite saved source records.</p></div><form action={settingsAction}><input type="hidden" name="workspaceId" value={workspaceId} /><div className="grid gap-5 p-5 sm:grid-cols-2"><label className="text-sm font-semibold">Business name<input className={input} name="businessName" defaultValue={initialSettings.businessName} required minLength={2} maxLength={200} disabled={!canEdit} /></label><label className="text-sm font-semibold">Currency<select className={input} name="currency" defaultValue={initialSettings.currency} disabled={!canEdit}>{currencyOptions.map((code) => <option key={code}>{code}</option>)}</select></label><label className="text-sm font-semibold">Timezone<select className={input} name="timezone" defaultValue={initialSettings.timezone} disabled={!canEdit}>{timezoneOptions.map((zone) => <option key={zone}>{zone}</option>)}</select></label><label className="text-sm font-semibold">Accounting basis<select className={input} name="accountingBasis" defaultValue={initialSettings.accountingBasis} disabled={!canEdit}><option value="accrual">Accrual</option><option value="cash">Cash</option></select></label><label className="text-sm font-semibold">Default date window<input className={input} name="matchDaysAfter" type="number" min="1" max="365" defaultValue={initialSettings.matchDaysAfter} disabled={!canEdit} /><span className="mt-1 block text-xs font-normal text-muted">Days after the invoice date.</span></label></div><div className="border-t p-5">{canEdit ? <SaveSettingsButton /> : <p className="text-sm text-muted">An organization owner or admin can change these settings.</p>}{settingsState.error ? <p className="mt-3 text-sm text-danger" role="alert">{settingsState.error}</p> : null}{settingsState.success ? <p className="mt-3 text-sm text-success" role="status">{settingsState.success}</p> : null}</div></form></section>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Plan and billing</h2><p className="mt-1 text-sm text-muted">Stripe hosts payment methods, invoices, cancellation, and subscription changes.</p></div><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-sm leading-6 text-muted-strong">Choose a plan or use the Stripe customer portal for this organization.</p><Link className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-brand bg-brand px-4 text-sm font-semibold text-white" href={`/settings/billing?organizationId=${encodeURIComponent(organizationId)}`}><CreditCard className="size-4" /> Open billing</Link></div></section>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Import notifications</h2><p className="mt-1 text-sm text-muted">Choose whether InvoiceReconcile emails you when a background import is ready or cannot be completed.</p></div><form action={emailAction} className="p-5"><input type="hidden" name="workspaceId" value={workspaceId} /><input type="hidden" name="enabled" value={String(importEmails)} /><label className="flex max-w-3xl items-start gap-3"><input className="mt-1 size-4 accent-brand" type="checkbox" checked={importEmails} disabled={initialTransactionalImportEmails === null} onChange={(event) => setImportEmails(event.target.checked)} /><span><span className="block text-sm font-semibold">Email me import status updates</span><span className="mt-1 block text-sm leading-6 text-muted">This preference applies to ready and failed background-import emails. In-app progress and notifications remain available either way.</span></span></label><div className="mt-4"><Button type="submit" disabled={initialTransactionalImportEmails === null}><Save className="size-4" /> Save notification preference</Button></div>{initialTransactionalImportEmails === null ? <p className="mt-3 text-sm text-warning" role="alert">Notification preferences are temporarily unavailable.</p> : null}{emailState.error ? <p className="mt-3 text-sm text-danger" role="alert">{emailState.error}</p> : null}{emailState.success ? <p className="mt-3 text-sm text-success" role="status">{emailState.success}</p> : null}</form></section>
    <TeamPanel organizationId={organizationId} initialMembers={teamMembers} canManage={canEdit} planEligible={teamPlanEligible} />
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Data access</h2><p className="mt-1 text-sm text-muted">Create a local JSON archive through your signed-in browser.</p></div><div className="p-5"><p className="max-w-3xl text-sm leading-6 text-muted-strong">The archive contains workspace imports, normalized invoices and payments, saved reconciliation runs, matches, decisions, rules, audit records, workspace usage, connection metadata, and feedback you submitted. It excludes integration secret references, internal feedback notes, and original files. Files up to 2 MiB on the synchronous request path are processed without a deliberate application-storage copy. Background sources are held temporarily in private storage, then scheduled for removal once their upload capability expires and retried until deletion is confirmed. Structured source records remain available under the workspace retention policy.</p><div className="mt-5 flex flex-wrap gap-3"><Button type="button" onClick={() => void exportArchive()} disabled={exporting}>{exporting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}{exporting ? "Preparing archive" : "Export workspace data"}</Button><Link className="inline-flex min-h-10 items-center justify-center border px-4 text-sm font-semibold" href="/privacy">Privacy policy</Link><Link className="inline-flex min-h-10 items-center justify-center border px-4 text-sm font-semibold" href="/security">Security</Link></div><p className="mt-4 text-xs leading-5 text-muted">If an export fails, contact <a className="font-semibold text-brand hover:underline" href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a> from the account email.</p></div></section>
    <section className="mt-6 border border-danger/30 bg-surface"><div className="border-b border-danger/20 p-5"><h2 className="font-semibold text-danger">Delete workspace</h2><p className="mt-1 text-sm text-muted">Deletion permanently removes this workspace and its imported records. An organization-level deletion audit entry remains. This cannot be undone.</p></div><form action={deleteAction} className="p-5"><input type="hidden" name="workspaceId" value={workspaceId} />{canDelete ? <><label className="text-sm font-semibold">Type DELETE to confirm<input className={`${input} max-w-sm`} name="confirmation" required autoComplete="off" /></label><div className="mt-4"><DeleteWorkspaceButton /></div></> : <p className="text-sm text-muted">Only an organization owner can delete a workspace.</p>}{deleteState.error ? <p className="mt-3 text-sm text-danger" role="alert">{deleteState.error}</p> : null}<p className="mt-4 max-w-2xl text-xs leading-5 text-muted">Remove any private source still shown in Imports and wait for its deletion status to be confirmed before deleting the workspace. The only workspace in a paid organization also cannot be deleted until its subscription is canceled in Billing.</p></form></section>
  </div>;
}
