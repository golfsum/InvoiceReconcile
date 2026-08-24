"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const defaultPageSize = 500;

const workspaceTables = [
  { name: "imports", select: "*", pageSize: defaultPageSize },
  { name: "import_rows", select: "*", pageSize: defaultPageSize },
  { name: "customers", select: "*", pageSize: defaultPageSize },
  { name: "payer_aliases", select: "*", pageSize: defaultPageSize },
  { name: "payment_sources", select: "*", pageSize: defaultPageSize },
  { name: "invoices", select: "*", pageSize: defaultPageSize },
  { name: "payments", select: "*", pageSize: defaultPageSize },
  { name: "reconciliation_runs", select: "*", pageSize: 25 },
  { name: "matches", select: "*", pageSize: defaultPageSize },
  { name: "match_invoice_links", select: "*", pageSize: defaultPageSize },
  { name: "match_payment_links", select: "*", pageSize: defaultPageSize },
  { name: "match_explanations", select: "*", pageSize: defaultPageSize },
  { name: "matching_rules", select: "*", pageSize: defaultPageSize },
  { name: "reconciliation_actions", select: "*", pageSize: defaultPageSize },
  {
    name: "audit_events",
    select: "id,organization_id,workspace_id,actor_user_id,actor_type,event_type,entity_type,entity_id,request_id,source_import_id,metadata,created_at",
    pageSize: defaultPageSize,
  },
  { name: "usage_records", select: "*", pageSize: defaultPageSize },
  {
    name: "integrations",
    select: "id,organization_id,workspace_id,provider,status,external_tenant_id,configuration,scopes,connected_by,connected_at,last_synced_at,last_error_code,created_at,updated_at",
    pageSize: defaultPageSize,
  },
  {
    name: "feedback",
    select: "id,user_id,organization_id,workspace_id,feedback_type,rating,message,contact_email,page_path,status,created_at,updated_at",
    pageSize: defaultPageSize,
  },
] as const;

export const workspaceArchiveTableNames = workspaceTables.map((table) => table.name);
export const workspaceArchiveColumnSelections = Object.fromEntries(
  workspaceTables.map((table) => [table.name, table.select]),
) as Readonly<Record<(typeof workspaceTables)[number]["name"], string>>;

export function safeWorkspaceArchiveFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "workspace";
}

export async function downloadWorkspaceArchive(workspaceId: string, workspaceName: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Workspace export is not configured in this environment.");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sign in again before exporting workspace data.");
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,organization_id,name,business_name,accounting_basis,currency_code,timezone,match_days_before,match_days_after,status,created_at,updated_at")
    .eq("id", workspaceId)
    .single();
  if (workspaceError || !workspace) throw new Error("This workspace is unavailable or you no longer have access.");

  const records: Record<string, unknown[]> = {};
  for (const table of workspaceTables) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += table.pageSize) {
      const query = supabase
        .from(table.name)
        .select(table.select)
        .eq("workspace_id", workspaceId)
        .order("id", { ascending: true })
        .range(from, from + table.pageSize - 1);
      const { data, error } = await query;
      if (error) throw new Error(`The ${table.name.replaceAll("_", " ")} records could not be exported.`);
      const page = data || [];
      rows.push(...page);
      if (page.length < table.pageSize) break;
    }
    records[table.name] = rows;
  }

  const archive = {
    format: "InvoiceReconcile workspace archive",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    exportedByUserId: authData.user.id,
    sourceFileRetention: "This archive includes import metadata and structured source records, not original files. Files up to 2 MiB on the synchronous request path are processed without a deliberate application-storage copy. Background sources are held temporarily in private storage and enter capability-safe, verified deletion after processing or within the 24-hour cleanup schedule.",
    workspace,
    records,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeWorkspaceArchiveFilename(workspaceName)}-workspace-archive.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
