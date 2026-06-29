import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { DriveHistoryLoader } from "@/components/customer/drive/drive-history";

export const dynamic = "force-dynamic";

/**
 * Page serveur VOLONTAIREMENT LÉGÈRE : elle ne fait QUE l'auth (pas d'`await`
 * des données) → la navigation n'est plus bloquée par un fetch. L'historique est
 * chargé par TanStack Query côté client (DriveHistoryLoader) : affichage instantané
 * depuis le cache au retour + revalidation silencieuse, plus de squelette plein
 * écran ni de re-téléchargement à chaque visite.
 */
export default async function DriveHistoriquePage() {
  // Session mémoïsée (partagée avec la coque client → pas de double auth).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/se-connecter?next=/drive/historique");
  return <DriveHistoryLoader customerId={customer.id} />;
}
