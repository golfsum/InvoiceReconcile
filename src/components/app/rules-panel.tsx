"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import type { WorkspacePayerRule, WorkspaceRuleCustomer } from "@/lib/reconciliation/payer-rules";
import type { CustomMatchingRule } from "@/lib/reconciliation/types";
import type { EntitlementPlan } from "@/lib/billing/entitlements";

type DemoRule = {
  id: string;
  pattern: string;
  customer: string;
  type: "payer_alias" | "description_customer" | "reference_pattern" | "fee_behavior";
};

type RulesPanelProps =
  | { mode: "demo" }
  | { mode: "unavailable" }
  | {
      mode: "live";
      workspaceId: string;
      initialRules: WorkspacePayerRule[];
      initialCustomRules?: CustomMatchingRule[];
      customers: WorkspaceRuleCustomer[];
      canEdit: boolean;
      customRulesEnabled?: boolean;
      plan?: EntitlementPlan;
    };

const demoInitialRules: DemoRule[] = [
  { id: "rule-1", pattern: "ACH ORIG: DESERT BLOOM", customer: "Desert Bloom Marketing LLC", type: "payer_alias" },
  { id: "rule-2", pattern: "NORTH RIM LANDSCAPE", customer: "North Rim Landscaping LLC", type: "payer_alias" },
  { id: "rule-3", pattern: "NS-2026-{digits}", customer: "Invoice reference extraction", type: "reference_pattern" },
];

function RulesHeader({ demo = false }: { demo?: boolean }) {
  return <div><p className="eyebrow">Matching rules</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Inspect and manage matching evidence</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{demo ? "This browser-only editor demonstrates how matching rules are reviewed. Demo rules are not applied to the sample reconciliation." : "Workspace rules add transparent identity or review evidence to future suggestions. They never override currency, date-window, ambiguity, or confirmation controls."}</p></div>;
}

function isDemoRule(value: unknown): value is DemoRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.id === "string"
    && typeof rule.pattern === "string"
    && typeof rule.customer === "string"
    && (rule.type === "payer_alias" || rule.type === "description_customer" || rule.type === "reference_pattern" || rule.type === "fee_behavior");
}

function DemoRulesPanel() {
  const [rules, setRules] = useState<DemoRule[]>(demoInitialRules);
  const [pattern, setPattern] = useState("");
  const [customer, setCustomer] = useState("");
  const [type, setType] = useState<DemoRule["type"]>("payer_alias");

  useEffect(() => {
    let restoreTimer: number | undefined;
    try {
      const raw = window.localStorage.getItem("ir_demo_rules_v1");
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isDemoRule)) return;
      restoreTimer = window.setTimeout(() => setRules(parsed), 0);
    } catch {
      // Storage can be blocked or contain older invalid demo state. Keep the fixture.
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, []);

  function persist(next: DemoRule[]) {
    try {
      window.localStorage.setItem("ir_demo_rules_v1", JSON.stringify(next));
      setRules(next);
      return true;
    } catch {
      toast.error("This browser could not save the demo rules.");
      return false;
    }
  }

  function addRule() {
    if (!pattern.trim() || !customer.trim()) {
      toast.error("Enter both the source pattern and its intended mapping.");
      return;
    }
    const next = [...rules, { id: crypto.randomUUID(), pattern: pattern.trim(), customer: customer.trim(), type }];
    if (!persist(next)) return;
    setPattern("");
    setCustomer("");
    toast.success("Demo matching rule added");
  }

  return <div className="mx-auto max-w-5xl"><RulesHeader demo />
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Add a demo rule</h2><p className="mt-1 text-sm text-muted">Changes stay in this browser as an editor demonstration. They do not affect live data or the sample matching results.</p></div><div className="grid gap-4 p-5 md:grid-cols-[180px_1fr_1fr_auto] md:items-end"><label className="text-sm font-semibold">Rule type<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={type} onChange={(event) => setType(event.target.value as DemoRule["type"])}><option value="payer_alias">Payer alias</option><option value="description_customer">Description mapping</option><option value="reference_pattern">Reference template</option><option value="fee_behavior">Accepted fee behavior</option></select></label><label className="text-sm font-semibold">Source pattern<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={pattern} maxLength={200} onChange={(event) => setPattern(event.target.value)} placeholder="ACH ORIG: ABC HOLDINGS" /></label><label className="text-sm font-semibold">Maps to<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={customer} maxLength={200} onChange={(event) => setCustomer(event.target.value)} placeholder="ABC Consulting LLC" /></label><Button type="button" onClick={addRule}><Plus className="size-4" /> Add rule</Button></div></section>
    <RuleList rules={rules.map((rule) => ({ id: rule.id, alias: rule.pattern, customerName: rule.customer, label: rule.type.replaceAll("_", " ") }))} summary={`${rules.length} browser-saved ${rules.length === 1 ? "demo rule" : "demo rules"}. These are not used by sample matching.`} onDelete={(id) => { if (persist(rules.filter((item) => item.id !== id))) toast.success("Demo rule deleted"); }} />
  </div>;
}

function apiMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function apiRule(value: unknown, customer: WorkspaceRuleCustomer): WorkspacePayerRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  if (typeof rule.id !== "string" || typeof rule.alias !== "string" || typeof rule.normalizedAlias !== "string"
      || typeof rule.customerId !== "string" || typeof rule.customerName !== "string" || typeof rule.createdAt !== "string") return null;
  return {
    id: rule.id,
    alias: rule.alias,
    normalizedAlias: rule.normalizedAlias,
    customerId: rule.customerId,
    customerName: rule.customerName,
    customerExternalId: customer.externalId,
    createdAt: rule.createdAt,
  };
}

function apiCustomRule(value: unknown, customers: WorkspaceRuleCustomer[]): CustomMatchingRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  if (typeof rule.id !== "string" || typeof rule.kind !== "string"
      || typeof rule.sourcePattern !== "string" || typeof rule.normalizedPattern !== "string") return null;
  if (rule.kind === "description_customer") {
    const customer = customers.find((item) => item.id === rule.customerId);
    if (!customer || typeof rule.customerName !== "string") return null;
    return {
      id: rule.id,
      kind: rule.kind,
      sourcePattern: rule.sourcePattern,
      normalizedPattern: rule.normalizedPattern,
      customerId: customer.id,
      customerName: rule.customerName,
      customerExternalId: customer.externalId,
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : undefined,
    };
  }
  if (rule.kind === "reference_template") {
    return {
      id: rule.id,
      kind: rule.kind,
      sourcePattern: rule.sourcePattern,
      normalizedPattern: rule.normalizedPattern,
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : undefined,
    };
  }
  if (rule.kind === "accepted_fee_behavior"
      && typeof rule.maximumFeeMinor === "number" && Number.isInteger(rule.maximumFeeMinor)
      && typeof rule.maximumFeeBasisPoints === "number" && Number.isInteger(rule.maximumFeeBasisPoints)) {
    return {
      id: rule.id,
      kind: rule.kind,
      sourcePattern: rule.sourcePattern,
      normalizedPattern: rule.normalizedPattern,
      maximumFeeMinor: rule.maximumFeeMinor,
      maximumFeeBasisPoints: rule.maximumFeeBasisPoints,
      createdAt: typeof rule.createdAt === "string" ? rule.createdAt : undefined,
    };
  }
  return null;
}

function customRuleLabel(rule: CustomMatchingRule) {
  if (rule.kind === "description_customer") return "description mapping";
  if (rule.kind === "reference_template") return "reference template";
  return "fee review";
}

function customRuleTarget(rule: CustomMatchingRule) {
  if (rule.kind === "description_customer") return rule.customerName;
  if (rule.kind === "reference_template") return "Extract a matching invoice reference";
  return `Review up to ${(rule.maximumFeeBasisPoints / 100).toFixed(2)}% and ${rule.maximumFeeMinor.toLocaleString("en-US")} minor units`;
}

function CustomRulesPanel({
  workspaceId,
  initialRules,
  customers,
  canEdit,
  customRulesEnabled,
  plan,
}: {
  workspaceId: string;
  initialRules: CustomMatchingRule[];
  customers: WorkspaceRuleCustomer[];
  canEdit: boolean;
  customRulesEnabled: boolean;
  plan: EntitlementPlan;
}) {
  const [rules, setRules] = useState(initialRules);
  const [kind, setKind] = useState<CustomMatchingRule["kind"]>("description_customer");
  const [pattern, setPattern] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [maximumFeeMinor, setMaximumFeeMinor] = useState("5000");
  const [maximumFeePercent, setMaximumFeePercent] = useState("3");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditingId(null);
    setKind("description_customer");
    setPattern("");
    setCustomerId(customers[0]?.id || "");
    setMaximumFeeMinor("5000");
    setMaximumFeePercent("3");
  }

  function beginEdit(rule: CustomMatchingRule) {
    setEditingId(rule.id);
    setKind(rule.kind);
    setPattern(rule.sourcePattern);
    setCustomerId(rule.kind === "description_customer" ? rule.customerId : customers[0]?.id || "");
    setMaximumFeeMinor(rule.kind === "accepted_fee_behavior" ? String(rule.maximumFeeMinor) : "5000");
    setMaximumFeePercent(rule.kind === "accepted_fee_behavior" ? String(rule.maximumFeeBasisPoints / 100) : "3");
    setError(null);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customer = customers.find((item) => item.id === customerId);
    const feeMinor = Number(maximumFeeMinor);
    const feeBasisPoints = Math.round(Number(maximumFeePercent) * 100);
    if (pattern.trim().length < 4
        || (kind === "description_customer" && !customer)
        || (kind === "accepted_fee_behavior" && (!Number.isInteger(feeMinor) || feeMinor < 1 || feeMinor > 25_000 || !Number.isInteger(feeBasisPoints) || feeBasisPoints < 1 || feeBasisPoints > 500))) {
      setError("Complete the bounded pattern and required rule values before saving.");
      return;
    }
    const payload = kind === "description_customer"
      ? { type: kind, pattern: pattern.trim(), customerId }
      : kind === "reference_template"
        ? { type: kind, pattern: pattern.trim() }
        : { type: kind, pattern: pattern.trim(), maximumFeeMinor: feeMinor, maximumFeeBasisPoints: feeBasisPoints };
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...payload, ruleId: editingId } : payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body, "The custom matching rule could not be saved."));
      const rawRule = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).rule : null;
      const saved = apiCustomRule(rawRule, customers);
      if (!saved) throw new Error("The saved custom matching rule could not be confirmed.");
      setRules((current) => [...current.filter((item) => item.id !== saved.id), saved]
        .sort((left, right) => customRuleLabel(left).localeCompare(customRuleLabel(right)) || left.sourcePattern.localeCompare(right.sourcePattern)));
      resetForm();
      toast.success(editingId ? "Custom rule updated" : "Custom rule saved", { description: "The bounded rule applies to future reconciliation runs." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The custom matching rule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: CustomMatchingRule) {
    setDeletingId(rule.id);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id, ruleType: rule.kind }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body, "The custom matching rule could not be deleted."));
      setRules((current) => current.filter((item) => item.id !== rule.id));
      if (editingId === rule.id) resetForm();
      toast.success("Custom rule deleted", { description: "Saved reconciliation runs retain their original evidence." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The custom matching rule could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  const formAvailable = canEdit && customRulesEnabled;
  return <>
    <section className="mt-6 border bg-surface">
      <div className="border-b p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Custom evidence rules</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted">Description mappings and bounded reference templates add identity evidence once per payment. Fee behavior only explains an already-safe short-pay review and always requires confirmation.</p></div><span className="bg-brand-soft px-2 py-1 text-xs font-bold text-brand">Business and Bookkeeper</span></div></div>
      {formAvailable ? <form className="grid gap-4 p-5" onSubmit={(event) => void saveRule(event)}>
        <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Rule type<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={kind} onChange={(event) => setKind(event.target.value as CustomMatchingRule["kind"])} disabled={Boolean(editingId)}><option value="description_customer">Description to customer</option><option value="reference_template">Reference template</option><option value="accepted_fee_behavior">Accepted fee review</option></select></label><label className="text-sm font-semibold">Payment text pattern<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={pattern} minLength={4} maxLength={kind === "reference_template" ? 80 : 120} required onChange={(event) => setPattern(event.target.value)} placeholder={kind === "reference_template" ? "NS-2026-{digits}" : kind === "accepted_fee_behavior" ? "CARD SETTLEMENT" : "PARENT COMPANY REMITTANCE"} /></label></div>
        <p className="text-xs leading-5 text-muted">Patterns accept basic Latin letters, digits, spaces, and standard punctuation so database and matching-engine normalization stay identical.</p>
        {kind === "description_customer" ? <label className="text-sm font-semibold">Maps to customer<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={customerId} required onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}{customer.externalId ? ` (${customer.externalId})` : ""}</option>)}</select></label> : null}
        {kind === "reference_template" ? <p className="text-sm leading-6 text-muted">Use exactly one <code>{"{digits}"}</code> or <code>{"{alnum}"}</code> token. Regex operators, unbounded wildcards, and scripts are not accepted.</p> : null}
        {kind === "accepted_fee_behavior" ? <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-semibold">Maximum fee in minor units<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" type="number" min={1} max={25000} step={1} value={maximumFeeMinor} required onChange={(event) => setMaximumFeeMinor(event.target.value)} /></label><label className="text-sm font-semibold">Maximum fee percent<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" type="number" min={0.01} max={5} step={0.01} value={maximumFeePercent} required onChange={(event) => setMaximumFeePercent(event.target.value)} /></label></div> : null}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving || (kind === "description_customer" && customers.length === 0)}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : editingId ? <Pencil className="size-4" /> : <Plus className="size-4" />}{saving ? "Saving rule" : editingId ? "Save changes" : "Add custom rule"}</Button>{editingId ? <Button type="button" variant="secondary" onClick={resetForm}><X className="size-4" /> Cancel edit</Button> : null}</div>
      </form> : canEdit ? <div className="p-5"><p className="text-sm leading-6 text-muted-strong">Your {plan === "solo" ? "Solo" : "Free"} plan keeps payer mappings available. Upgrade to add description, reference, and fee-review rules. Existing custom rules remain inspectable and can be deleted.</p><a className={buttonVariants({ className: "mt-3" })} href="/settings/billing">Compare plans</a></div> : <p className="p-5 text-sm text-muted">Custom rules are read only for viewers. Workspace owners, admins, and members can manage them.</p>}
      {error ? <p className="border-t px-5 py-3 text-sm text-danger" role="alert">{error}</p> : null}
    </section>
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Active custom rules</h2><p className="mt-1 text-sm text-muted">{rules.length} {rules.length === 1 ? "rule is" : "rules are"} stored for this workspace{customRulesEnabled ? "." : "; they are not applied on the current plan."}</p></div><div className="divide-y">{rules.map((rule) => <div key={rule.id} className="grid gap-3 p-5 md:grid-cols-[170px_1fr_1fr_auto] md:items-center"><span className="w-fit bg-brand-soft px-2 py-1 text-xs font-bold capitalize text-brand">{customRuleLabel(rule)}</span><div><p className="font-mono text-xs font-semibold">{rule.sourcePattern}</p><p className="mt-1 text-xs text-muted">Bounded normalized pattern</p></div><div><p className="text-sm font-semibold">{customRuleTarget(rule)}</p><p className="mt-1 text-xs text-muted">{rule.kind === "accepted_fee_behavior" ? "Evidence only; confirmation required" : "Future-run identity evidence"}</p></div>{canEdit ? <div className="flex gap-2">{customRulesEnabled ? <button type="button" className="inline-flex size-9 items-center justify-center border text-muted hover:border-brand hover:text-brand disabled:opacity-60" aria-label={`Edit custom rule ${rule.sourcePattern}`} disabled={deletingId === rule.id || editingId === rule.id} onClick={() => beginEdit(rule)}><Pencil className="size-4" /></button> : null}<button type="button" className="inline-flex size-9 items-center justify-center border text-muted hover:border-danger hover:text-danger disabled:cursor-wait disabled:opacity-60" aria-label={`Delete custom rule ${rule.sourcePattern}`} disabled={deletingId === rule.id} onClick={() => void deleteRule(rule)}>{deletingId === rule.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button></div> : <span className="text-xs text-muted">Read only</span>}</div>)}{rules.length === 0 ? <p className="p-8 text-center text-sm text-muted">No custom rules yet. Core amount, reference, payer, date, currency, and ambiguity controls remain active.</p> : null}</div></section>
  </>;
}

function LiveRulesPanel({
  workspaceId,
  initialRules,
  initialCustomRules = [],
  customers,
  canEdit,
  customRulesEnabled = false,
  plan = "free",
}: Extract<RulesPanelProps, { mode: "live" }>) {
  const [rules, setRules] = useState(initialRules);
  const [alias, setAlias] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customer = customers.find((item) => item.id === customerId);
    if (alias.trim().length < 2 || !customer) {
      setError("Enter a payer name and choose a customer from this workspace.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: alias.trim(), customerId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body, "The payer mapping could not be saved."));
      const rawRule = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).rule : null;
      const saved = apiRule(rawRule, customer);
      if (!saved) throw new Error("The saved payer mapping could not be confirmed.");
      setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved].sort((left, right) => left.alias.localeCompare(right.alias)));
      setAlias("");
      toast.success("Payer mapping saved", { description: "It will add identity evidence to future reconciliation suggestions." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payer mapping could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: WorkspacePayerRule) {
    setDeletingId(rule.id);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule.id }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body, "The payer mapping could not be deleted."));
      setRules((current) => current.filter((item) => item.id !== rule.id));
      toast.success("Payer mapping deleted", { description: "Saved reconciliation runs keep their original evidence." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payer mapping could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }

  function beginEdit(rule: WorkspacePayerRule) {
    setEditingId(rule.id);
    setEditAlias(rule.alias);
    setEditCustomerId(rule.customerId);
    setError(null);
  }

  async function updateRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customer = customers.find((item) => item.id === editCustomerId);
    if (!editingId || editAlias.trim().length < 2 || !customer) {
      setError("Enter a payer name and choose a customer from this workspace.");
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: editingId, alias: editAlias.trim(), customerId: editCustomerId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body, "The payer mapping could not be updated."));
      const rawRule = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).rule : null;
      const saved = apiRule(rawRule, customer);
      if (!saved) throw new Error("The updated payer mapping could not be confirmed.");
      setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved].sort((left, right) => left.alias.localeCompare(right.alias)));
      setEditingId(null);
      setEditAlias("");
      setEditCustomerId("");
      toast.success("Payer mapping updated", { description: "The revised identity evidence applies to future reconciliation runs." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payer mapping could not be updated.");
    } finally {
      setUpdating(false);
    }
  }

  return <div className="mx-auto max-w-5xl"><RulesHeader />
    <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Add a payer mapping</h2><p className="mt-1 text-sm text-muted">Use the normalized payer shown by the bank file and map it to an existing customer from prior invoice imports.</p></div>{canEdit ? customers.length ? <form className="grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={(event) => void addRule(event)}><label className="text-sm font-semibold">Payer name<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={alias} minLength={2} maxLength={200} required onChange={(event) => setAlias(event.target.value)} placeholder="ACH ORIG: ABC HOLDINGS" /></label><label className="text-sm font-semibold">Maps to customer<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={customerId} required onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}{customer.externalId ? ` (${customer.externalId})` : ""}</option>)}</select></label><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{saving ? "Saving mapping" : "Add mapping"}</Button></form> : <p className="p-5 text-sm text-muted">Import invoices first so the mapping can target a saved customer.</p> : <p className="p-5 text-sm text-muted">Workspace owners, admins, and members can change payer mappings. Viewers can inspect active rules.</p>}{error ? <p className="border-t px-5 py-3 text-sm text-danger" role="alert">{error}</p> : null}</section>
    {editingId ? <section className="mt-6 border border-brand/30 bg-brand-soft/30"><div className="flex items-start justify-between gap-4 border-b border-brand/20 p-5"><div><h2 className="font-semibold">Edit payer mapping</h2><p className="mt-1 text-sm text-muted">Changes apply to future suggestions. Saved reconciliation runs retain their original evidence.</p></div><button type="button" className="inline-flex size-9 items-center justify-center border bg-surface text-muted hover:text-foreground" aria-label="Cancel editing payer mapping" onClick={() => setEditingId(null)}><X className="size-4" /></button></div><form className="grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={(event) => void updateRule(event)}><label className="text-sm font-semibold">Payer name<input className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={editAlias} minLength={2} maxLength={200} required onChange={(event) => setEditAlias(event.target.value)} /></label><label className="text-sm font-semibold">Maps to customer<select className="mt-1.5 h-10 w-full border bg-background px-3 font-normal" value={editCustomerId} required onChange={(event) => setEditCustomerId(event.target.value)}>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}{customer.externalId ? ` (${customer.externalId})` : ""}</option>)}</select></label><Button type="submit" disabled={updating}>{updating ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}{updating ? "Updating mapping" : "Save changes"}</Button></form></section> : null}
    <RuleList
      rules={rules.map((rule) => ({ id: rule.id, alias: rule.alias, customerName: rule.customerName, label: "payer mapping" }))}
      editingId={editingId}
      deletingId={deletingId}
      onEdit={canEdit ? (id) => { const rule = rules.find((item) => item.id === id); if (rule) beginEdit(rule); } : undefined}
      onDelete={canEdit ? (id) => { const rule = rules.find((item) => item.id === id); if (rule) void deleteRule(rule); } : undefined}
    />
    <CustomRulesPanel
      workspaceId={workspaceId}
      initialRules={initialCustomRules}
      customers={customers}
      canEdit={canEdit}
      customRulesEnabled={customRulesEnabled}
      plan={plan}
    />
  </div>;
}

function RuleList({ rules, editingId, deletingId, onEdit, onDelete, summary }: { rules: Array<{ id: string; alias: string; customerName: string; label: string }>; editingId?: string | null; deletingId?: string | null; onEdit?: (id: string) => void; onDelete?: (id: string) => void; summary?: string }) {
  return <section className="mt-6 border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Active rules</h2><p className="mt-1 text-sm text-muted">{summary ?? `${rules.length} ${rules.length === 1 ? "rule is" : "rules are"} applied after payer-name normalization.`}</p></div><div className="divide-y">{rules.map((rule) => <div key={rule.id} className="grid gap-3 p-5 md:grid-cols-[160px_1fr_1fr_auto] md:items-center"><span className="w-fit bg-brand-soft px-2 py-1 text-xs font-bold capitalize text-brand">{rule.label}</span><div><p className="font-mono text-xs font-semibold">{rule.alias}</p><p className="mt-1 text-xs text-muted">Normalized payer evidence</p></div><div><p className="text-sm font-semibold">{rule.customerName}</p><p className="mt-1 text-xs text-muted">Mapped customer</p></div>{onEdit || onDelete ? <div className="flex gap-2">{onEdit ? <button type="button" className="inline-flex size-9 items-center justify-center border text-muted hover:border-brand hover:text-brand disabled:opacity-60" aria-label={`Edit rule ${rule.alias}`} disabled={deletingId === rule.id || editingId === rule.id} onClick={() => onEdit(rule.id)}><Pencil className="size-4" /></button> : null}{onDelete ? <button type="button" className="inline-flex size-9 items-center justify-center border text-muted hover:border-danger hover:text-danger disabled:cursor-wait disabled:opacity-60" aria-label={`Delete rule ${rule.alias}`} disabled={deletingId === rule.id} onClick={() => onDelete(rule.id)}>{deletingId === rule.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button> : null}</div> : <span className="text-xs text-muted">Read only</span>}</div>)}{rules.length === 0 ? <p className="p-8 text-center text-sm text-muted">No active payer mappings yet. Suggestions will continue using source IDs, invoice references, names, dates, amounts, and currency.</p> : null}</div></section>;
}

function UnavailableRulesPanel() {
  return <div className="mx-auto max-w-5xl"><RulesHeader /><div className="mt-6 border border-warning/30 bg-warning-soft p-5" role="alert"><h2 className="font-semibold text-warning">Matching rules are temporarily unavailable.</h2><p className="mt-2 text-sm leading-6 text-muted-strong">No rule data is being substituted. Reload before changing rules or running a reconciliation that depends on them.</p><Button className="mt-4" type="button" variant="secondary" onClick={() => window.location.reload()}><RotateCw className="size-4" /> Reload rules</Button></div></div>;
}

export function RulesPanel(props: RulesPanelProps) {
  if (props.mode === "unavailable") return <UnavailableRulesPanel />;
  if (props.mode === "demo") return <DemoRulesPanel />;
  return <LiveRulesPanel {...props} />;
}
