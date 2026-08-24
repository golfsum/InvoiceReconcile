import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { requireAdmin } from "@/lib/auth/access";
import { loadAdminMetrics } from "@/lib/admin/live";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin operations", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await requireAdmin();
  const metrics = await loadAdminMetrics(user);
  return <AdminDashboard metrics={metrics} operatorName={user.name} />;
}
