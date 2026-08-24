import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { initializeAsyncSourceSchema, canonicalImportContentType } from "@/lib/imports/async-contract";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { importSourceLifecycleWorkflow } from "@/workflows/import-source";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 12_000) {
    return NextResponse.json({ error: "The upload request is too large." }, { status: 413 });
  }
  const limit = await checkRateLimit({
    key: privacySafeRequestKey(request, "import-source-init"),
    prefix: "import-source-init",
    limit: 20,
    windowSeconds: 300,
  });
  if (!limit.allowed) return NextResponse.json({
    error: limit.source === "unavailable"
      ? "Secure upload authorization is temporarily unavailable."
      : "Too many uploads were started. Wait a few minutes and try again.",
  }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });

  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();
  if (!supabase || !service) return NextResponse.json({
    error: "Private background imports are not configured. No upload was authorized.",
  }, { status: 503, headers: rateLimitHeaders(limit) });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    logServerError(authError, { operation: "async_import_source_auth", code: authError.code });
    return NextResponse.json({ error: "Import authorization is temporarily unavailable." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  if (!authData.user) return NextResponse.json({ error: "Sign in before uploading workspace files." }, { status: 401, headers: rateLimitHeaders(limit) });

  const parsed = initializeAsyncSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({
    error: "Choose a CSV or XLSX file up to 50 MB before starting the upload.",
  }, { status: 400, headers: rateLimitHeaders(limit) });
  const { data, error } = await supabase.rpc("initialize_async_import_source", {
    p_workspace_id: parsed.data.workspaceId,
    p_import_kind: parsed.data.kind,
    p_source_type: parsed.data.sourceType,
    p_expected_byte_size: parsed.data.byteSize,
    p_expected_sha256: parsed.data.sha256,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    logServerError(error, { operation: "initialize_async_import_source", code: error.code });
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 503;
    return NextResponse.json({ error: status === 403
      ? "You do not have permission to upload files to this workspace."
      : status === 400
        ? "The upload request is invalid or expired."
        : "The private upload could not be authorized safely." }, { status, headers: rateLimitHeaders(limit) });
  }
  if (!isRecord(data)
      || typeof data.source_id !== "string"
      || typeof data.storage_path !== "string"
      || typeof data.upload_expires_at !== "string"
      || typeof data.status !== "string") {
    logServerError(new Error("Upload intent RPC returned an invalid result"), { operation: "initialize_async_import_source" });
    return NextResponse.json({ error: "The private upload could not be authorized safely." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  if (data.status !== "awaiting_upload") return NextResponse.json({
    error: "This upload request has already been used. Start a new file upload.",
    sourceId: data.source_id,
    status: data.status,
  }, { status: 409, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } });

  try {
    await start(importSourceLifecycleWorkflow, [data.source_id]);
  } catch (workflowError) {
    logServerError(workflowError, { operation: "start_import_source_lifecycle" });
    return NextResponse.json({ error: "Background source retention could not be scheduled. No upload URL was issued." }, { status: 503, headers: rateLimitHeaders(limit) });
  }
  const { data: capability, error: capabilityError } = await service.rpc(
    "worker_register_async_import_upload_capability",
    { p_source_id: data.source_id },
  );
  if (capabilityError
      || !isRecord(capability)
      || capability.storage_bucket !== "import-source-files"
      || capability.storage_path !== data.storage_path
      || typeof capability.safe_delete_at !== "string") {
    logServerError(capabilityError || new Error("Upload capability registration was invalid"), { operation: "register_async_import_upload_capability" });
    return NextResponse.json({ error: "The private upload authorization expired. Start the upload again." }, { status: capabilityError?.code === "22023" ? 409 : 503, headers: rateLimitHeaders(limit) });
  }
  const { data: signedUpload, error: signedUploadError } = await service.storage
    .from("import-source-files")
    .createSignedUploadUrl(capability.storage_path, { upsert: false });
  if (signedUploadError || !signedUpload) {
    logServerError(signedUploadError || new Error("Signed upload response missing"), { operation: "create_async_import_upload_url" });
    return NextResponse.json({ error: "The private upload URL could not be issued." }, { status: 503, headers: rateLimitHeaders(limit) });
  }

  return NextResponse.json({
    sourceId: data.source_id,
    uploadUrl: signedUpload.signedUrl,
    expiresAt: data.upload_expires_at,
    contentType: canonicalImportContentType(parsed.data.sourceType),
    maxBytes: 50 * 1024 * 1024,
  }, {
    status: 201,
    headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store, max-age=0" },
  });
}
