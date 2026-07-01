import { requireAdminDomain } from "@/lib/auth/admin";
import { NotificationsView } from "@/components/admin/notifications/notifications-view";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Notifications du hub
// Marketing (/admin/marketing/notifications).
export default async function AdminNotificationsPage() {
  await requireAdminDomain("marketing");
  return <NotificationsView />;
}
