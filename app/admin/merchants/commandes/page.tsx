import { AdminOrdersExplorer } from "@/components/admin/pilotage/admin-orders-explorer";
import { searchAdminOrders } from "@/lib/data/admin-orders";
import {
  buildSearchFilters,
  ORDERS_PAGE_SIZE,
  type OrdersSearchParams,
} from "@/lib/data/admin-orders-params";

export const dynamic = "force-dynamic";

// Onglet « Commandes » du hub Commerçants : même explorateur (recherche
// multi-critères) que /admin/orders, dans le contexte Commerçants. La RPC
// admin_search_orders accepte les domaines pilotage ET commercants.
export default async function MerchantOrdersTab({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const sp = await searchParams;
  const { filters, explorer, page } = buildSearchFilters(sp);
  const { rows, total } = await searchAdminOrders(filters);

  return (
    <div>
      <p className="text-muted mb-4 text-sm">
        Recherche combinée (numéro, client, commerçant, livreur, statut,
        paiement, période). Ouvre une commande pour la gérer.
      </p>
      <AdminOrdersExplorer
        rows={rows}
        total={total}
        page={page}
        pageSize={ORDERS_PAGE_SIZE}
        filters={explorer}
        basePath="/admin/merchants/commandes"
      />
    </div>
  );
}
