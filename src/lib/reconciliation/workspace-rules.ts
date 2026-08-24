import "server-only";

import { createHash } from "node:crypto";
import { logServerError } from "@/lib/logger";
import { entitlementPlanSchema, type EntitlementPlan } from "@/lib/billing/entitlements";
import { canonicalDescriptionPattern, canonicalReferenceTemplate } from "./custom-rules";
import {
  loadWorkspacePayerRuleCatalog,
  type WorkspacePayerRule,
  type WorkspaceRuleCustomer,
} from "./payer-rules";
import type { CustomMatchingRule, ReconciliationContext } from "./types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServerClient>>>;

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

export type WorkspaceMatchingRuleCatalog = {
  payerMappings: WorkspacePayerRule[];
  customRules: CustomMatchingRule[];
  customers: WorkspaceRuleCustomer[];
  plan: EntitlementPlan;
  customRulesEnabled: boolean;
  payerMappingFingerprint: string;
  matchingRuleFingerprint?: string;
};

export type WorkspaceMatchingRuleLoadResult =
  | { status: "ready"; catalog: WorkspaceMatchingRuleCatalog }
  | { status: "unavailable" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function activePlan(value: unknown): EntitlementPlan {
  const row = record(value);
  if (!row || !ACTIVE_SUBSCRIPTION_STATUSES.has(String(row.status))) return "free";
  const parsed = entitlementPlanSchema.safeParse(row.plan_code);
  return parsed.success ? parsed.data : "free";
}

export function customMatchingRuleFingerprint(rules: CustomMatchingRule[]) {
  const behavior = rules.map((rule) => {
    if (rule.kind === "description_customer") {
      return {
        kind: rule.kind,
        sourcePattern: rule.sourcePattern,
        normalizedPattern: canonicalDescriptionPattern(rule.normalizedPattern || rule.sourcePattern) || "",
        customerId: rule.customerId,
        customerExternalId: rule.customerExternalId?.trim().toUpperCase() || "",
        customerName: canonicalDescriptionPattern(rule.customerName) || "",
      };
    }
    if (rule.kind === "reference_template") {
      return {
        kind: rule.kind,
        sourcePattern: rule.sourcePattern,
        normalizedPattern: canonicalReferenceTemplate(rule.normalizedPattern || rule.sourcePattern) || "",
      };
    }
    return {
      kind: rule.kind,
      sourcePattern: rule.sourcePattern,
      normalizedPattern: canonicalDescriptionPattern(rule.normalizedPattern || rule.sourcePattern) || "",
      maximumFeeMinor: rule.maximumFeeMinor,
      maximumFeeBasisPoints: rule.maximumFeeBasisPoints,
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(behavior)).digest("hex");
}

export function buildWorkspaceCustomRules(
  rawRules: unknown,
  customers: WorkspaceRuleCustomer[],
): CustomMatchingRule[] | null {
  if (!Array.isArray(rawRules)) return null;
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const rules: CustomMatchingRule[] = [];
  for (const value of rawRules) {
    const row = record(value);
    if (!row) return null;
    const id = optionalString(row.id);
    const ruleType = optionalString(row.rule_type);
    const sourcePattern = optionalString(row.source_pattern);
    const normalizedPattern = optionalString(row.normalized_pattern);
    const actionType = optionalString(row.action_type);
    const createdAt = optionalString(row.created_at);
    const configuration = record(row.configuration);
    if (!id || !ruleType || !sourcePattern || !normalizedPattern || !actionType || !createdAt || !configuration) return null;

    if (ruleType === "description_pattern" && actionType === "map_customer") {
      const customerId = optionalString(row.customer_id);
      const customer = customerId ? customersById.get(customerId) : undefined;
      const canonical = canonicalDescriptionPattern(sourcePattern);
      if (!customerId || !customer || !canonical || canonical !== normalizedPattern
          || configuration.matchMode !== "contains_normalized"
          || Object.keys(configuration).length !== 1) return null;
      rules.push({
        id,
        kind: "description_customer" as const,
        sourcePattern,
        normalizedPattern,
        customerId,
        customerName: customer.name,
        customerExternalId: customer.externalId,
        createdAt,
      });
      continue;
    }

    if (ruleType === "reference_pattern" && actionType === "extract_reference") {
      const canonical = canonicalReferenceTemplate(sourcePattern);
      if (row.customer_id !== null || !canonical || canonical !== normalizedPattern
          || configuration.templateVersion !== 1
          || Object.keys(configuration).length !== 1) return null;
      rules.push({ id, kind: "reference_template", sourcePattern, normalizedPattern, createdAt });
      continue;
    }

    if (ruleType === "fee_behavior" && actionType === "flag_possible_fee") {
      const normalized = canonicalDescriptionPattern(sourcePattern);
      const maximumFeeMinor = integer(configuration.maximumFeeMinor);
      const maximumFeeBasisPoints = integer(configuration.maximumFeeBasisPoints);
      if (row.customer_id !== null || !normalized || normalized !== normalizedPattern
          || maximumFeeMinor === undefined || maximumFeeMinor < 1 || maximumFeeMinor > 25_000
          || maximumFeeBasisPoints === undefined || maximumFeeBasisPoints < 1 || maximumFeeBasisPoints > 500
          || Object.keys(configuration).length !== 2) return null;
      rules.push({
        id,
        kind: "accepted_fee_behavior" as const,
        sourcePattern,
        normalizedPattern,
        maximumFeeMinor,
        maximumFeeBasisPoints,
        createdAt,
      });
      continue;
    }
    return null;
  }
  return rules.sort((left, right) =>
    left.kind.localeCompare(right.kind)
    || left.normalizedPattern.localeCompare(right.normalizedPattern)
    || left.id.localeCompare(right.id));
}

export function workspaceRuleRuntime(catalog: WorkspaceMatchingRuleCatalog): {
  context: ReconciliationContext;
  payerMappingFingerprint: string;
  matchingRuleFingerprint?: string;
} {
  return {
    context: {
      payerMappings: catalog.payerMappings,
      customRules: catalog.customRulesEnabled ? catalog.customRules : [],
    },
    payerMappingFingerprint: catalog.payerMappingFingerprint,
    matchingRuleFingerprint: catalog.matchingRuleFingerprint,
  };
}

export async function loadWorkspaceMatchingRuleCatalog(
  supabase: ServerSupabaseClient,
  workspaceId: string,
  knownOrganizationId?: string,
): Promise<WorkspaceMatchingRuleLoadResult> {
  const [payerResult, customResult, workspaceResult] = await Promise.all([
    loadWorkspacePayerRuleCatalog(supabase, workspaceId),
    supabase
      .from("matching_rules")
      .select("id,rule_type,source_pattern,normalized_pattern,customer_id,action_type,configuration,created_at")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100),
    knownOrganizationId
      ? Promise.resolve({ data: { organization_id: knownOrganizationId }, error: null })
      : supabase
          .from("workspaces")
          .select("organization_id")
          .eq("id", workspaceId)
          .eq("status", "active")
          .maybeSingle(),
  ]);
  if (payerResult.status !== "ready" || customResult.error || workspaceResult.error || !workspaceResult.data) {
    logServerError(customResult.error || workspaceResult.error || new Error("Workspace rule catalog is unavailable"), {
      operation: "load_workspace_matching_rules",
      code: customResult.error?.code || workspaceResult.error?.code,
    });
    return { status: "unavailable" };
  }
  const organizationId = optionalString((workspaceResult.data as Record<string, unknown>).organization_id);
  if (!organizationId) return { status: "unavailable" };
  const [subscriptionResult, organizationResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan_code,status")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("status")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  if (subscriptionResult.error || organizationResult.error || organizationResult.data?.status !== "active") {
    const error = subscriptionResult.error || organizationResult.error || new Error("Organization is not active");
    logServerError(error, {
      operation: "load_workspace_matching_rule_plan",
      code: subscriptionResult.error?.code || organizationResult.error?.code,
    });
    return { status: "unavailable" };
  }
  const customRules = buildWorkspaceCustomRules(customResult.data, payerResult.catalog.customers);
  if (!customRules) {
    logServerError(new Error("Workspace custom rule data is invalid"), { operation: "load_workspace_matching_rules" });
    return { status: "unavailable" };
  }
  const plan = activePlan(subscriptionResult.data);
  const customRulesEnabled = plan === "business" || plan === "bookkeeper";
  return {
    status: "ready",
    catalog: {
      payerMappings: payerResult.catalog.rules,
      customRules,
      customers: payerResult.catalog.customers,
      plan,
      customRulesEnabled,
      payerMappingFingerprint: payerResult.catalog.fingerprint,
      matchingRuleFingerprint: customRulesEnabled && customRules.length
        ? customMatchingRuleFingerprint(customRules)
        : undefined,
    },
  };
}
