import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DeliveryHistoryLoader } from "@/components/driver/delivery-history";

export const dynamic = "force-dynamic";

/**
 * Page serveur VOLONTAIREMENT LÉGÈRE : elle ne fait QUE l'auth (pas d'`await` des
 * données) → la navigation n'est plus bloquée par un fetch. L'historique est
 * chargé par TanStack Query côté client (DeliveryHistoryLoader, clé par livreur) :
 * affichage instantané depuis le cache au retour + revalidation silencieuse, plus
 * de re-téléchargement à chaque visite.
 */
export default async function DriverHistoryPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DeliveryHistoryLoader
      driverId={driver.id}
      driverFirstName={driver.full_name.split(" ")[0]}
    />
  );
}
