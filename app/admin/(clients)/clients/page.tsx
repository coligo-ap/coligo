import { listCustomers } from "@/lib/data/admin-customers";
import { CustomersView } from "@/components/admin/clients/customers-view";

export const dynamic = "force-dynamic";

/**
 * Annuaire CLIENTS. La première page est rendue au serveur (affichage
 * immédiat) ; la recherche, les filtres et la pagination vivent ensuite côté
 * client sur cache TanStack Query — la frappe reste instantanée et une page
 * déjà vue se réaffiche sans aller-retour.
 */
export default async function AdminClientsPage() {
  const initial = await listCustomers({ page: 1 });
  return <CustomersView initial={initial} />;
}
