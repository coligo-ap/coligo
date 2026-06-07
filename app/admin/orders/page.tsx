import { createClient } from "@/lib/supabase/server";
import { AdminOrdersManager } from "@/components/admin/admin-orders-manager";

export const dynamic = "force-dynamic";

/**
 * Gestion super-admin des commandes : voir tout + valider une livraison,
 * annuler à n'importe quelle étape (suivi conservé), rembourser le commerçant.
 * Le layout /admin gate déjà sur requireSuperAdmin() ; RLS orders_select_admin
 * (mig 0071) autorise la lecture de toutes les commandes.
 */

type AdminOrderRow = {
  id: string;
  order_number: string | null;
  status: string;
  fulfillment_type: string | null;
  delivery_mode: string | null;
  payment_method: string;
  payment_status: string;
  total_da: number;
  delivery_fee_da: number | null;
  delivery_driver_id: string | null;
  delivery_picked_up_at: string | null;
  delivery_arrived_at: string | null;
  delivery_delivered_at: string | null;
  customer_name: string | null;
  merchant_id: string;
  merchant_name: string;
  created_at: string;
};

export default async function AdminOrdersPage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, fulfillment_type, delivery_mode,
       payment_method, payment_status, total_da, delivery_fee_da,
       delivery_driver_id, delivery_picked_up_at, delivery_arrived_at,
       delivery_delivered_at, customer_name, merchant_id, created_at`
    )
    .order("created_at", { ascending: false })
    .limit(120);

  const rows = (orders ?? []) as Omit<AdminOrderRow, "merchant_name">[];
  const merchantIds = Array.from(new Set(rows.map((r) => r.merchant_id)));
  const { data: merchants } = merchantIds.length
    ? await supabase
        .from("merchants_public")
        .select("id, name")
        .in("id", merchantIds)
    : { data: [] };
  const nameOf = new Map<string, string>(
    (merchants ?? []).map((m) => [m.id, m.name])
  );

  const full: AdminOrderRow[] = rows.map((r) => ({
    ...r,
    merchant_name: nameOf.get(r.merchant_id) ?? "—",
  }));

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
