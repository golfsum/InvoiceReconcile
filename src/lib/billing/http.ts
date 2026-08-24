import "server-only";

import { z } from "zod";
import type { AppUser } from "@/lib/auth/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const billingOrganizationIdSchema = z.string().uuid().optional();

type BillingMembership = {
  organization_id: string;
  role: "admin" | "owner";
};

export async function resolveBillingOrganization(user: AppUser, requestedOrganizationId?: string) {
  if (user.source !== "supabase") {
    return { ok: false as const, status: 409, code: "demo_billing_unavailable" };
  }
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { ok: false as const, status: 503, code: "billing_storage_unavailable" };

  let query = supabase
    .from("memberships")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (requestedOrganizationId) query = query.eq("organization_id", requestedOrganizationId);
  const { data, error } = await query.limit(2);
  if (error) return { ok: false as const, status: 503, code: "billing_storage_unavailable" };
  const memberships = (data || []) as BillingMembership[];
  if (memberships.length === 0) return { ok: false as const, status: 403, code: "billing_admin_required" };
  if (!requestedOrganizationId && memberships.length > 1) {
    return { ok: false as const, status: 409, code: "organization_required" };
  }
  return { ok: true as const, organizationId: memberships[0].organization_id, supabase };
}

export function safeReturnPath(value: string | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) return fallback;
    const base = new URL("https://invoicereconcile.com");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
