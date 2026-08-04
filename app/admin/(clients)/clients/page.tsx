import { listCustomers } from "@/lib/data/admin-customers";
import { CustomersView } from "@/components/admin/clients/customers-view";

export const dynamic = "force-dynamic";

/**
 * Annuaire CLIENTS — recherche d'abord. Le serveur ne rend qu'un ÉCHANTILLON
 * (3 dernières inscriptions + compteur total) : on ne télécharge jamais tout
 * l'annuaire d'office, la recherche/les filtres chargent la suite à la
 * demande (pages complètes serveur, cache côté vue).
 */
export default async function AdminClientsPage() {
  const initial = await listCustomers({ page: 1, limit: 3 });
  return <CustomersView initial={initial} />;
}
