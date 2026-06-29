import { NotificationsView } from "@/components/admin/notifications/notifications-view";

export const dynamic = "force-dynamic";

// Route transverse conservée. Même vue que l'onglet Notifications du hub
// Marketing (/admin/marketing/notifications).
export default function AdminNotificationsPage() {
  return <NotificationsView />;
}
