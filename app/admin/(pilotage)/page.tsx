import {
  getPlatformDashboard,
  getMerchantRowsForAdmin,
} from "@/lib/data/platform";
import { AdminDashboardView } from "@/components/admin/admin-dashboard-view";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [stats, merchants] = await Promise.all([
    getPlatformDashboard(),
    getMerchantRowsForAdmin(),
  ]);
  return <AdminDashboardView stats={stats} merchants={merchants} />;
}
