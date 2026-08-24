import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSafeXlsxArchive, assertWorkbookWithinLimits, decodeSafeCsv, fingerprintImport, mappingFromSuggestions, newestCompatibleSavedColumnMapping, parseCsv, suggestColumns, uploadSafetyMessage, worksheetRowsToObjects } from "@/lib/imports";
import { logServerError } from "@/lib/logger";
import { checkRateLimit, privacySafeRequestKey, rateLimitHeaders, verifySameOrigin } from "@/lib/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const requestSchema = z.enum(["invoice", "payment"]);
const workspaceIdSchema = z.string().uuid();

async function recentSavedMappings(workspaceId: string, kind: "invoice" | "payment") {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" as const };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    logServerError(authError, { operation: "import_preview_auth", code: authError.code });
    return { status: "unavailable" as const };
  }
  if (!authData.user) return { status: "unauthenticated" as const };

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError) {
    logServerError(workspaceError, { operation: "import_preview_workspace", code: workspaceError.code });
    return { status: "unavailable" as const };
  }
  if (!workspace) return { status: "forbidden" as const };

  const { data, error } = await supabase
    .from("imports")
    .select("column_mapping")
    .eq("workspace_id", workspaceId)
    .eq("import_type", kind === "invoice" ? "invoices" : "payments")
    .in("status", ["completed", "completed_with_errors"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    logServerError(error, { operation: "import_preview_saved_mapping", code: error.code });
    return { status: "unavailable" as const };
  }
  return {
    status: "ready" as const,
    mappings: Array.isArray(data) ? data.map((row) => row.column_mapping) : [],
  };
}

export async function POST(request: Request) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_FILE_SIZE + 100_000) return NextResponse.json({ error: "The upload is larger than the 2 MB preview limit." }, { status: 413 });
  const limit = await checkRateLimit({ key: privacySafeRequestKey(request, "import-preview"), prefix: "import-preview", limit: 30, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ error: limit.source === "unavailable" ? "Import preview is temporarily unavailable." : "Too many preview attempts. Wait a few minutes and try again." }, { status: limit.source === "unavailable" ? 503 : 429, headers: rateLimitHeaders(limit) });
  const form = await request.formData();
  const file = form.get("file");
  const kind = requestSchema.safeParse(form.get("kind"));
  const requestedWorkspaceId = form.get("workspaceId")?.toString().trim() || null;
  const requestedSheet = form.get("sheet")?.toString();
  if (!(file instanceof File) || !kind.success) return NextResponse.json({ error: "Choose an invoice or payment file to preview." }, { status: 400 });
  if (requestedWorkspaceId && requestedWorkspaceId !== "demo" && !workspaceIdSchema.safeParse(requestedWorkspaceId).success) {
    return NextResponse.json({ error: "Choose a valid workspace before previewing this file." }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "The selected file is empty." }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "The file is larger than the 2 MB preview limit." }, { status: 413 });

  const savedMappingResult = requestedWorkspaceId && requestedWorkspaceId !== "demo"
    ? await recentSavedMappings(requestedWorkspaceId, kind.data)
    : { status: "ready" as const, mappings: [] };
  if (savedMappingResult.status === "unauthenticated") return NextResponse.json({ error: "Sign in before previewing files for this workspace." }, { status: 401 });
  if (savedMappingResult.status === "forbidden") return NextResponse.json({ error: "You do not have access to preview files for this workspace." }, { status: 403 });
  if (savedMappingResult.status === "unavailable") return NextResponse.json({ error: "Saved workspace mappings are temporarily unavailable. No file was processed." }, { status: 503 });

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") return NextResponse.json({ error: "Use a CSV or XLSX file for this import." }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    let headers: string[] = [];
    let rows: Record<string, unknown>[] = [];
    let issues: { message: string; row?: number }[] = [];
    let sheets: string[] = [];
    let selectedSheet: string | undefined;

    if (extension === "csv") {
      const parsed = parseCsv(decodeSafeCsv(bytes));
      headers = parsed.headers;
      rows = parsed.rows;
      issues = parsed.issues;
    } else {
      assertSafeXlsxArchive(bytes);
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      assertWorkbookWithinLimits(workbook);
      sheets = workbook.worksheets.map((worksheet) => worksheet.name);
      const worksheet = (requestedSheet ? workbook.getWorksheet(requestedSheet) : undefined) || workbook.worksheets.find((item) => item.actualRowCount > 0);
      if (!worksheet) return NextResponse.json({ error: "The workbook does not contain a readable worksheet." }, { status: 422 });
      selectedSheet = worksheet.name;
      const rawRows: unknown[][] = [];
      worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rawRows.push(values);
      });
      const converted = worksheetRowsToObjects(rawRows);
      headers = converted.headers;
      rows = converted.rows;
    }

    if (headers.length === 0) return NextResponse.json({ error: "We could not find a header row. Add column headings or choose another worksheet." }, { status: 422 });
    const suggestions = suggestColumns(headers, kind.data);
    const savedMapping = newestCompatibleSavedColumnMapping(savedMappingResult.mappings, headers, kind.data);
    const mapping = savedMapping || mappingFromSuggestions(suggestions);
    return NextResponse.json({
      file: { name: file.name, size: file.size, fingerprint: fingerprintImport(bytes) },
      kind: kind.data,
      headers,
      rowCount: rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim())).length,
      preview: rows.slice(0, 8),
      suggestions,
      mapping,
      mappingSource: savedMapping ? "saved" : "detected",
      issues: issues.slice(0, 20),
      sheets,
      selectedSheet,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: uploadSafetyMessage(code, extension) }, { status: 422 });
  }
}
