import { BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import {
  PartnerBackHeader,
  PartnerEmptyState,
} from "@/components/shared/partner-ui";
import { DriverNotificationsList } from "@/components/driver/notifications-list";

export const dynamic = "force-dynamic";

/**
 * Notifications internes du livreur (validation de compte, refus de dossier…).
 * Trace durable des messages de l'équipe Coligo : elle survit à un push manqué
 * ou effacé. Lecture protégée par RLS (`driver_notifications_owner_read`).
 */
export default async function DriverNotificationsPage() {
  const gate = await requireActiveDriver();
  const supabase = await createClient();

  const { data } = await supabase
    .from("driver_notifications")
    .select("id, kind, title, body, route, read_at, created_at")
    .eq("driver_id", gate.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const items = data ?? [];

  return (
    <DriverShell driverFirstName={gate.firstName}>
      <PartnerBackHeader
        href="/driver/parametres"
        title="Notifications"
        subtitle="Messages de l'équipe Coligo"
      />
      {items.length === 0 ? (
        <PartnerEmptyState
          icon={<BellOff className="size-5" />}
          title="Aucune notification"
          text="Les messages de l'équipe Coligo apparaîtront ici."
        />
      ) : (
        <DriverNotificationsList items={items} />
      )}
    </DriverShell>
  );
}
