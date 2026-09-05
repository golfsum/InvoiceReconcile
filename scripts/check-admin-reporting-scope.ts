// Read-only verification: pipe a Supabase db query JSON result containing
// rows[0].snapshot (table-name -> row array). Prints counts, never record contents.
import { readFileSync } from "node:fs";
import { filterAdminReportingRows } from "../src/lib/admin/reporting-scope";

const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
const snapshot = input.rows?.[0]?.snapshot as Record<string, Record<string, unknown>[]> | undefined;
if (!snapshot?.admin_reporting_exclusions) throw new Error("Expected a reporting snapshot with exclusions");
const filtered = filterAdminReportingRows(snapshot, snapshot.admin_reporting_exclusions, process.env.ADMIN_EMAILS);
console.log(JSON.stringify(Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, {
  source: rows.length,
  reported: filtered[table].length,
  excluded: rows.length - filtered[table].length,
}])), null, 2));
