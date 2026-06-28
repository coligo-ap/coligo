import { AdminOrdersManager } from "@/components/admin/admin-orders-manager";
import { getAdminOrders } from "@/lib/data/admin-orders";

export const dynamic = "force-dynamic";

/**
 * Gestion super-admin des commandes : voir tout + valider une livraison,
 * annuler à n'importe quelle étape (suivi conservé), rembourser le commerçant.
 * Le layout /admin gate déjà sur requireSuperAdmin() ; RLS orders_select_admin
 * (mig 0071) autorise la lecture de toutes les commandes.
 * Données : loader partagé getAdminOrders (cf. hub Commerçants).
 */

export default async function AdminOrdersPage() {
  const full = await getAdminOrders();

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Commandes</h1>
        <p className="text-muted mt-1 text-sm">
          Vue plateforme. Valider une livraison, annuler à toute étape (le suivi
          est conservé), ou rembourser le commerçant.
        </p>
      </header>
      <AdminOrdersManager rows={full} />
    </div>
  );
}
