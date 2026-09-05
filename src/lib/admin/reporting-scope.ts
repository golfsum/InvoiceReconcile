type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const text = (value: unknown) => typeof value === "string" ? value : "";

// Reporting only. Never changes authorization, subscriptions or source records.
export function filterAdminReportingRows(tables: Tables, exclusions: Row[], adminEmails = ""): Tables {
  const ids = (kind: string) => new Set(exclusions.filter((row) => row.kind === kind).map((row) => text(row.subject_id)));
  const users = ids("user");
  const organizations = ids("organization");
  const contacts = ids("contact_request");
  const emails = new Set(adminEmails.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  for (const row of tables.profiles || []) {
    if (row.is_internal_admin === true || emails.has(text(row.email).toLowerCase())) users.add(text(row.id));
  }
  for (const row of tables.organizations || []) {
    const id = text(row.id);
    const externalMember = (tables.memberships || []).some((member) => member.organization_id === id
      && member.status === "active" && member.user_id && !users.has(text(member.user_id)));
    if (users.has(text(row.created_by)) && !externalMember) organizations.add(id);
  }
  const internal = (row: Row) => users.has(text(row.user_id)) || organizations.has(text(row.organization_id));
  const events = tables.analytics_events || [];
  const anonymous = ids("anonymous");
  const sessions = ids("session");
  // Link pre-login activity only to identifiers observed on internal activity.
  // A shared browser/session with an identified customer is not excluded wholesale.
  for (const [field, excluded] of [["anonymous_id", anonymous], ["session_id", sessions]] as const) {
    const customerIds = new Set(events.filter((row) => row.user_id && !internal(row)).map((row) => text(row[field])));
    for (const event of events) {
      const id = text(event[field]);
      if (id && internal(event) && !customerIds.has(id)) excluded.add(id);
    }
  }
  const hasInternalScope = users.size > 0 || organizations.size > 0 || anonymous.size > 0 || sessions.size > 0;
  return Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.filter((row) => {
    if (table === "profiles") return !users.has(text(row.id));
    if (table === "organizations") return !organizations.has(text(row.id));
    if (table === "contact_requests" && contacts.has(text(row.id))) return false;
    if (internal(row)) return false;
    if (table === "analytics_events" && !row.user_id
      && (anonymous.has(text(row.anonymous_id)) || sessions.has(text(row.session_id)))) return false;
    // Unscoped rollups cannot have internal usage subtracted reliably. Rebuild
    // dashboard totals from filtered raw events and usage records instead.
    if (table === "analytics_daily_aggregates" && !row.organization_id && hasInternalScope) return false;
    return true;
  })]));
}
