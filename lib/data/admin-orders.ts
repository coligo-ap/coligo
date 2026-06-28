import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Chargement des commandes côté super-admin — source unique partagée entre la
// vue plateforme (/admin/orders) et l'onglet « Commandes » du hub Commerçants
// (/admin/merchants/commandes). Aucune logique métier ici : lecture seule.
// Le gate super-admin est assuré par app/admin/layout.tsx ; RLS orders_select_admin
// (mig 0071) autorise la lecture de toutes les commandes.
// =============================================================================

export type AdminOrderRow = {
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

export async function getAdminOrders(limit = 120): Promise<AdminOrderRow[]> {
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
    .limit(limit);

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

  return rows.map((r) => ({
    ...r,
    merchant_name: nameOf.get(r.merchant_id) ?? "—",
  }));
}
