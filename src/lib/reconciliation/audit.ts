import "server-only";

import { cache } from "react";
import { logServerError } from "@/lib/logger";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type WorkspaceAuditActor = {
  id?: string;
  type: "user" | "system" | "integration" | "support";
  name: string;
};

export type WorkspaceAuditEvent = {
  id: string;
  eventType: string;
  actor: WorkspaceAuditActor;
  entity?: { type: string; id?: string };
  requestId?: string;
  sourceImport?: { id: string; type?: string; filename?: string };
  metadata: Record<string, unknown>;
  action?: {
    id: string;
    type: string;
    note?: string;
    previousState: Record<string, unknown>;
    newState: Record<string, unknown>;
  };
  createdAt: string;
};

export type WorkspaceAuditResult =
  | { status: "ready"; events: WorkspaceAuditEvent[]; nextCursor: string | null }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvent(value: unknown): WorkspaceAuditEvent | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.eventType !== "string" || typeof value.createdAt !== "string") return null;
  if (!isRecord(value.actor) || typeof value.actor.name !== "string" || !["user", "system", "integration", "support"].includes(String(value.actor.type))) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const event: WorkspaceAuditEvent = {
    id: value.id,
    eventType: value.eventType,
    actor: {
      id: typeof value.actor.id === "string" ? value.actor.id : undefined,
      type: value.actor.type as WorkspaceAuditActor["type"],
      name: value.actor.name,
    },
    metadata,
    createdAt: value.createdAt,
  };
  if (isRecord(value.entity) && typeof value.entity.type === "string") {
    event.entity = { type: value.entity.type, id: typeof value.entity.id === "string" ? value.entity.id : undefined };
  }
  if (typeof value.requestId === "string") event.requestId = value.requestId;
  if (isRecord(value.sourceImport) && typeof value.sourceImport.id === "string") {
    event.sourceImport = {
      id: value.sourceImport.id,
      type: typeof value.sourceImport.type === "string" ? value.sourceImport.type : undefined,
      filename: typeof value.sourceImport.filename === "string" ? value.sourceImport.filename : undefined,
    };
  }
  if (isRecord(value.action) && typeof value.action.id === "string" && typeof value.action.type === "string") {
    event.action = {
      id: value.action.id,
      type: value.action.type,
      note: typeof value.action.note === "string" ? value.action.note : undefined,
      previousState: isRecord(value.action.previousState) ? value.action.previousState : {},
      newState: isRecord(value.action.newState) ? value.action.newState : {},
    };
  }
  return event;
}

export const loadWorkspaceAuditEvents = cache(async (
  workspaceId: string,
  beforeId: string | null,
): Promise<WorkspaceAuditResult> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { status: "unavailable" };
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { status: "unavailable" };
  const { data, error } = await supabase.rpc("get_workspace_audit_events", {
    p_workspace_id: workspaceId,
    p_before_id: beforeId,
    p_limit: 25,
  });
  if (error) {
    logServerError(error, { operation: "load_workspace_audit_events", code: error.code });
    return { status: "unavailable" };
  }
  if (!isRecord(data) || !Array.isArray(data.events)) return { status: "unavailable" };
  const events: WorkspaceAuditEvent[] = [];
  for (const value of data.events) {
    const event = parseEvent(value);
    if (!event) return { status: "unavailable" };
    events.push(event);
  }
  const nextCursor = data.next_cursor === null || data.next_cursor === undefined
    ? null
    : typeof data.next_cursor === "string" && /^\d+$/.test(data.next_cursor)
      ? data.next_cursor
      : null;
  return { status: "ready", events, nextCursor };
});
