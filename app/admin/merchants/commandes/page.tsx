import { AdminOrdersManager } from "@/components/admin/admin-orders-manager";
import { getAdminOrders } from "@/lib/data/admin-orders";

export const dynamic = "force-dynamic";

// Onglet « Commandes » du hub Commerçants : même vue plateforme que
// /admin/orders (loader partagé getAdminOrders), dans le contexte Commerçants.
export default async function MerchantOrdersTab() {
  const rows = await getAdminOrders();

  return (
    <div>
      <p className="text-muted mb-5 text-sm">
        Vue plateforme. Valider une livraison, annuler à toute étape (le suivi
        est conservé), ou rembourser le commerçant.
      </p>
      <AdminOrdersManager rows={rows} />
    </div>
  );
}
