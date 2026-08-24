import "server-only";

import { createHash } from "node:crypto";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeEntityName } from "./normalize";
import type { PayerMappingRule } from "./types";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;

export type WorkspaceRuleCustomer = {
  id: string;
  name: string;
  externalId?: string;
};

export type WorkspacePayerRule = PayerMappingRule & {
  createdAt: string;
};

export type WorkspacePayerRuleCatalog = {
  rules: WorkspacePayerRule[];
  customers: WorkspaceRuleCustomer[];
  fingerprint: string;
};

export type WorkspacePayerRuleLoadResult =
  | { status: "ready"; catalog: WorkspacePayerRuleCatalog }
  | { status: "unavailable" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function payerMappingFingerprint(rules: PayerMappingRule[]) {
  const behavior = rules
    .map((rule) => ({
      alias: normalizeEntityName(rule.alias) || normalizeEntityName(rule.normalizedAlias),
      customerId: rule.customerId,
      customerExternalId: rule.customerExternalId?.trim() || "",
      customerName: normalizeEntityName(rule.customerName),
    }))
    .filter((rule) => rule.alias && rule.customerName)
    .sort((left, right) =>
      left.alias.localeCompare(right.alias)
      || left.customerId.localeCompare(right.customerId)
      || left.customerExternalId.localeCompare(right.customerExternalId)
      || left.customerName.localeCompare(right.customerName));
  return createHash("sha256").update(JSON.stringify(behavior)).digest("hex");
}

export function buildWorkspacePayerRuleCatalog(
  rawAliases: unknown,
  rawCustomers: unknown,
): WorkspacePayerRuleCatalog | null {
  if (!Array.isArray(rawAliases) || !Array.isArray(rawCustomers)) return null;

  const customerRows = rawCustomers.flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const id = optionalString(row.id);
    const name = optionalString(row.name);
    const status = optionalString(row.status);
    if (!id || !name || !status) return [];
    return [{ id, name, externalId: optionalString(row.external_id), status }];
  });
  if (customerRows.length !== rawCustomers.length) return null;

  const customersById = new Map(customerRows.map((customer) => [customer.id, customer]));
  const rules = rawAliases.flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const id = optionalString(row.id);
    const alias = optionalString(row.alias);
    const normalizedAlias = optionalString(row.normalized_alias);
    const customerId = optionalString(row.customer_id);
    const createdAt = optionalString(row.created_at);
    const matchType = optionalString(row.match_type);
    const customer = customerId ? customersById.get(customerId) : undefined;
    if (!id || !alias || !normalizedAlias || !customerId || !createdAt || matchType !== "exact_normalized" || !customer || customer.status !== "active") return [];
    return [{
      id,
      alias,
      normalizedAlias,
      customerId,
      customerName: customer.name,
      customerExternalId: customer.externalId,
      createdAt,
    }];
  });
  if (rules.length !== rawAliases.length) return null;

  const customers = customerRows
    .filter((customer) => customer.status === "active")
    .map(({ id, name, externalId }) => ({ id, name, externalId }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  rules.sort((left, right) => left.alias.localeCompare(right.alias) || left.id.localeCompare(right.id));

  return { rules, customers, fingerprint: payerMappingFingerprint(rules) };
}

export async function loadWorkspacePayerRuleCatalog(
  supabase: ServerSupabaseClient,
  workspaceId: string,
): Promise<WorkspacePayerRuleLoadResult> {
  const [aliasResult, customerResult] = await Promise.all([
    supabase
      .from("payer_aliases")
      .select("id,alias,normalized_alias,customer_id,match_type,created_at")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1_000),
    supabase
      .from("customers")
      .select("id,name,external_id,status")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .limit(1_000),
  ]);
  if (aliasResult.error || customerResult.error) {
    logServerError(aliasResult.error || customerResult.error, {
      operation: "load_workspace_payer_rules",
      code: aliasResult.error?.code || customerResult.error?.code,
    });
    return { status: "unavailable" };
  }

  const catalog = buildWorkspacePayerRuleCatalog(aliasResult.data, customerResult.data);
  if (!catalog) {
    logServerError(new Error("Workspace payer rule data is invalid"), {
      operation: "load_workspace_payer_rules",
    });
    return { status: "unavailable" };
  }
  return { status: "ready", catalog };
}
