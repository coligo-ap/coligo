import { AdminOrdersExplorer } from "@/components/admin/pilotage/admin-orders-explorer";
import { searchAdminOrders } from "@/lib/data/admin-orders";
import {
  buildSearchFilters,
  ORDERS_PAGE_SIZE,
  type OrdersSearchParams,
} from "@/lib/data/admin-orders-params";

export const dynamic = "force-dynamic";

/**
 * Recherche avancée des commandes (super-admin) : n°/client/téléphone,
 * commerçant, livreur, statut, paiement, mode, période — filtres combinables
 * portés par l'URL. Chaque ligne ouvre la fiche /admin/orders/[id] (détails,
 * historique, actions). Recherche côté serveur : RPC admin_search_orders
 * (0338), gardée admin_can('pilotage'|'commercants').
 */

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const sp = await searchParams;
  const { filters, explorer, page } = buildSearchFilters(sp);
  const { rows, total } = await searchAdminOrders(filters);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Commandes</h1>
        <p className="text-muted mt-1 text-sm">
          Recherche par numéro, client, commerçant, livreur, statut, paiement ou
          période — les filtres se combinent. Ouvre une commande pour la gérer.
        </p>
      </header>
      {/* Cible de l'alerte « livraisons récupérées sans issue » (?focus=…) :
          l'explorateur, déjà pré-filtré par le href de l'alerte. */}
      <div
        data-alert-focus="deliveries_stuck_in_transit"
        className="rounded-lg"
      >
        <AdminOrdersExplorer
          rows={rows}
          total={total}
          page={page}
          pageSize={ORDERS_PAGE_SIZE}
          filters={explorer}
          basePath="/admin/orders"
        />
      </div>
    </div>
  );
}
