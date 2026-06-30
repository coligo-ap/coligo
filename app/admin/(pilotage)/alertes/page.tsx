import {
  getLateOrdersForAdmin,
  LATE_ALERT_THRESHOLD_MIN,
} from "@/lib/data/platform";
import { AdminAlertCenterView } from "@/components/admin/admin-alert-center-view";
import type { AlertDomain } from "@/lib/alerts/alert-model";

export const dynamic = "force-dynamic";

const DOMAINS: AlertDomain[] = [
  "pilotage",
  "commercants",
  "livraison",
  "drive",
  "finances",
  "confiance",
  "plateforme",
  "marketing",
];

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const { domain } = await searchParams;
  const initialDomain =
    domain && DOMAINS.includes(domain as AlertDomain)
      ? (domain as AlertDomain)
      : null;

  // Le détail des commandes en retard (drill-down Pilotage) reste fetché côté
  // serveur ; la liste des alertes elle-même est lue LIVE depuis le provider.
  const lateOrders = await getLateOrdersForAdmin();

  return (
    <AdminAlertCenterView
      lateOrders={lateOrders}
      thresholdMin={LATE_ALERT_THRESHOLD_MIN}
      initialDomain={initialDomain}
    />
  );
}
