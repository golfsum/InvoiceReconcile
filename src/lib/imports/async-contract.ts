import { z } from "zod";

export const asyncSourceIdSchema = z.string().uuid();
export const asyncWorkspaceIdSchema = z.string().uuid();
export const asyncIdempotencyKeySchema = z.string().uuid();
export const asyncImportKindSchema = z.enum(["invoice", "payment"]);
export const asyncSourceTypeSchema = z.enum(["csv", "xlsx"]);
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const initializeAsyncSourceSchema = z.object({
  workspaceId: asyncWorkspaceIdSchema,
  kind: asyncImportKindSchema,
  sourceType: asyncSourceTypeSchema,
  byteSize: z.number().int().min(1).max(50 * 1024 * 1024),
  sha256: sha256Schema,
  idempotencyKey: asyncIdempotencyKeySchema,
}).strict();

export const enqueueAsyncReconciliationSchema = z.object({
  workspaceId: asyncWorkspaceIdSchema,
  invoiceSourceId: asyncSourceIdSchema,
  paymentSourceId: asyncSourceIdSchema,
  invoiceMapping: z.record(z.string(), z.string()).refine((value) => JSON.stringify(value).length <= 65_536),
  paymentMapping: z.record(z.string(), z.string()).refine((value) => JSON.stringify(value).length <= 65_536),
  idempotencyKey: asyncIdempotencyKeySchema,
}).strict();

export const requeueAsyncPreviewSchema = z.object({
  sheet: z.string().trim().min(1).max(200),
}).strict();

export const asyncSourceStatusSchema = z.enum([
  "awaiting_upload",
  "preview_queued",
  "preview_processing",
  "preview_ready",
  "reconciling",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export const asyncReconciliationStatusSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
]);

export function canonicalImportContentType(sourceType: z.infer<typeof asyncSourceTypeSchema>) {
  return sourceType === "xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
}
