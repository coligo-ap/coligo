import {
  getLateOrdersForAdmin,
  LATE_ALERT_THRESHOLD_MIN,
} from "@/lib/data/platform";
import { AdminLateOrdersView } from "@/components/admin/admin-late-orders-view";

export const dynamic = "force-dynamic";

export default async function AdminAlertsPage() {
  const orders = await getLateOrdersForAdmin();
  return (
    <AdminLateOrdersView
      orders={orders}
      thresholdMin={LATE_ALERT_THRESHOLD_MIN}
    />
  );
}
