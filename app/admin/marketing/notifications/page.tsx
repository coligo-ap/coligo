import { NotificationsView } from "@/components/admin/notifications/notifications-view";

export const dynamic = "force-dynamic";

// Onglet « Notifications » du hub Marketing (vue partagée avec /admin/notifications).
export default function MarketingNotificationsTab() {
  return <NotificationsView />;
}
