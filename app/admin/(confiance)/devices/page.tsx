import { getDevicesData } from "@/lib/data/admin-devices";
import { DevicesView } from "@/components/admin/devices-view";

export const dynamic = "force-dynamic";

/**
 * Appareils & connexions (super-admin) — traçage IP / localisation / appareil
 * (alimenté par /api/telemetry/ping) + anti-fraude (IP partagées) + blocage IP /
 * déconnexion de sessions. Le rendu + la recherche sont CÔTÉ CLIENT (DevicesView,
 * cache TanStack Query) ; ici on ne fait que fournir les données initiales.
 */
export default async function AdminDevicesPage() {
  const initial = await getDevicesData();
  return <DevicesView initial={initial} />;
}
