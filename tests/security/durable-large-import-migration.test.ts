import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608230017_durable_large_import_workflows.sql",
  "utf8",
);
const sourceRoute = readFileSync("src/app/api/imports/sources/route.ts", "utf8");
const importWorkflow = readFileSync("src/workflows/import-source.ts", "utf8");
const reconciliationWorkflow = readFileSync("src/workflows/reconciliation.ts", "utf8");

describe("durable large import security contract", () => {
  it("binds immutable tenant, actor, file, hash, nonce, and exact-path intent", () => {
    expect(migration).toMatch(/created_by uuid not null references public\.profiles/i);
    expect(migration).toMatch(/expected_byte_size bigint not null/i);
    expect(migration).toMatch(/expected_sha256 text not null/i);
    expect(migration).toMatch(/upload_nonce uuid not null/i);
    expect(migration).toMatch(/unique \(storage_bucket, storage_path\)/i);
    expect(migration).toMatch(/v_organization_id::text \|\| '\/' \|\| p_workspace_id::text[\s\S]*v_source_id::text[\s\S]*v_nonce::text/i);
    expect(migration).toMatch(/where o\.bucket_id = v_source\.storage_bucket and o\.name = v_source\.storage_path/i);
    expect(migration).toMatch(/metadata ->> 'mimetype', ''\) <> v_source\.expected_content_type/i);
    expect(migration).toMatch(/v_object_size <> v_source\.expected_byte_size/i);
  });

  it("keeps browser and service mutations behind constrained RPCs", () => {
    expect(migration).toMatch(/revoke all on public\.import_source_uploads[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate on public\.import_source_uploads, public\.async_reconciliation_requests\s+from service_role/i);
    expect(migration).toMatch(/grant select on public\.import_source_uploads, public\.async_reconciliation_requests to service_role/i);
    expect(migration).toMatch(/auth\.role\(\) is distinct from 'service_role'/i);
    expect(migration).toMatch(/revoke all on function public\.worker_cleanup_async_import_source\(uuid, boolean\)[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.worker_cleanup_async_import_source\(uuid, boolean\) to service_role/i);
  });

  it("does not let a never-issued intent fence tenant deletion", () => {
    expect(migration).toMatch(/object_deletion_status, object_deleted_at[\s\S]*'deleted', statement_timestamp\(\)/i);
    expect(migration).toMatch(/delete from public\.import_source_uploads s[\s\S]*upload_expires_at <= statement_timestamp\(\)[\s\S]*upload_capability_safe_delete_at is null[\s\S]*object_deletion_status = 'deleted'/i);
    expect(migration).toMatch(/worker_register_async_import_upload_capability[\s\S]*upload_capability_safe_delete_at is null[\s\S]*object_deletion_status = 'retained'[\s\S]*object_deleted_at = null/i);
    expect(migration).toMatch(/create trigger workspaces_require_private_import_source_cleanup[\s\S]*before delete on public\.workspaces/i);
    expect(migration).toMatch(/create trigger organizations_require_private_import_source_cleanup[\s\S]*before delete on public\.organizations/i);
    expect(migration).toMatch(/object_deletion_status <> 'deleted'/i);
  });

  it("serializes capability issuance against organization and workspace deletion", () => {
    const registration = migration.slice(
      migration.indexOf("create or replace function public.worker_register_async_import_upload_capability"),
      migration.indexOf("create or replace function public.requeue_async_import_preview"),
    );
    const organizationLock = registration.indexOf("from public.organizations o");
    const workspaceLock = registration.indexOf("from public.workspaces w");
    const sourceLock = registration.indexOf("select * into v_source");
    expect(organizationLock).toBeGreaterThan(-1);
    expect(workspaceLock).toBeGreaterThan(organizationLock);
    expect(sourceLock).toBeGreaterThan(workspaceLock);
    expect(registration).toMatch(/from public\.organizations o[\s\S]*for update[\s\S]*from public\.workspaces w[\s\S]*for update[\s\S]*select \* into v_source[\s\S]*for update/i);
    expect(migration).toMatch(/finalize_async_import_source[\s\S]*object_deletion_status <> 'retained'[\s\S]*upload_capability_safe_delete_at is null/i);
  });

  it("defers every deletion until signed capabilities expire and records a receipt", () => {
    expect(migration).toMatch(/interval '2 hours 5 minutes'/i);
    expect(migration).toMatch(/upload_capability_safe_delete_at > statement_timestamp\(\)[\s\S]*'upload_capability_active'/i);
    expect(migration).toMatch(/worker_confirm_async_import_source_deleted[\s\S]*signed upload capability has not expired/i);
    expect(migration).toMatch(/worker_confirm_async_import_source_deleted[\s\S]*storage\.objects object[\s\S]*object\.bucket_id = v_source\.storage_bucket[\s\S]*object\.name = v_source\.storage_path[\s\S]*Storage has not confirmed removal/i);
    expect(migration).toMatch(/object_deletion_status = 'deleted', object_deleted_at = coalesce\(object_deleted_at, statement_timestamp\(\)\)/i);
    expect(migration).toMatch(/retention_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/i);
    expect(importWorkflow).toContain('sleep("24h")');
    expect(importWorkflow).not.toContain('sleep("30d")');
    expect(reconciliationWorkflow).toMatch(/data\.status === "upload_capability_active"\) return \{ deleted: false \}/);
  });

  it("reclaims stale processing without claiming object deletion first", () => {
    expect(migration).toMatch(/status = 'preview_processing'[\s\S]*worker_claim_expires_at <= statement_timestamp\(\)[\s\S]*status = 'expired'/i);
    expect(migration).toMatch(/status = 'reconciling'[\s\S]*worker_claim_expires_at > statement_timestamp\(\)[\s\S]*status = 'failed'/i);
    expect(migration).toMatch(/object_deletion_status = 'pending'[\s\S]*'delete_object', true, 'deleted', false/i);
  });

  it("checks active entitlement at enqueue, worker claim, and commit", () => {
    expect(migration.match(/status in \('active', 'trialing', 'past_due'\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toMatch(/worker_claim_async_reconciliation[\s\S]*v_payment\.row_count > v_plan_limit/i);
    expect(migration).toMatch(/worker_complete_async_reconciliation[\s\S]*v_recorded \+ v_pending \+ p_billable_payment_count > v_limit/i);
  });

  it("provides a bounded, tenant-checked saved-run read model", () => {
    expect(migration).toMatch(/create table public\.reconciliation_run_read_items/i);
    expect(migration).toMatch(/p_limit not between 1 and 100/i);
    expect(migration).toMatch(/app_private\.can_access_workspace\(p_workspace_id\)/i);
    expect(migration).toMatch(/revoke all on public\.import_source_uploads[\s\S]*public\.reconciliation_run_read_items[\s\S]*from public, anon, authenticated/i);
  });

  it("starts a durable lifecycle before issuing a non-overwrite signed upload", () => {
    const startIndex = sourceRoute.indexOf("start(importSourceLifecycleWorkflow");
    const registerIndex = sourceRoute.indexOf("worker_register_async_import_upload_capability");
    const signIndex = sourceRoute.indexOf("createSignedUploadUrl");
    expect(startIndex).toBeGreaterThan(-1);
    expect(registerIndex).toBeGreaterThan(startIndex);
    expect(signIndex).toBeGreaterThan(registerIndex);
    expect(sourceRoute).toMatch(/createSignedUploadUrl\(capability\.storage_path, \{ upsert: false \}\)/);
    expect(sourceRoute).not.toMatch(/getPublicUrl|console\.(log|error)/);
  });

  it("keeps financial payloads in one Node step and applies the combined rule catalog", () => {
    expect(reconciliationWorkflow).toMatch(/loadWorkspaceMatchingRuleCatalog\(service, claim\.workspace_id\)/);
    expect(reconciliationWorkflow).toMatch(/workspaceRuleRuntime\(rules\.catalog\)/);
    expect(reconciliationWorkflow).toMatch(/reconcile\([\s\S]*ruleRuntime\.context/);
    expect(reconciliationWorkflow).toMatch(/matchingRuleFingerprint: ruleRuntime\.matchingRuleFingerprint/);
    expect(reconciliationWorkflow).not.toMatch(/console\.(log|error)/);
  });
});
