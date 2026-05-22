import { createClient } from "@/lib/supabase/server";
import { OrdersListView } from "@/components/merchant/orders-list-view";
import type { OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const supabase = await createClient();

  // RLS filtre déjà sur le commerçant connecté.
  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `id, merchant_id, customer_name, customer_phone, status,
       total_da, service_fee_da, cashback_da, commission_da,
       pickup_code, pickup_slot_at, notes, created_at,
       order_items ( id, order_id, product_name, unit_price_da, quantity, line_total_da )`
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement des commandes : {error.message}
        </div>
      </div>
    );
  }

  return <OrdersListView orders={(orders ?? []) as OrderWithItems[]} />;
}
