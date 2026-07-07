import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminContext } from "@/lib/auth/admin";

// =============================================================================
// Données commandes côté super-admin.
// - `searchAdminOrders` : recherche multi-critères paginée via la RPC
//   `admin_search_orders` (0338) — gardée `admin_can('pilotage'|'commercants')`
//   côté SQL (fail-closed), appelée avec la SESSION admin.
// - `getAdminOrderDetail` : fiche complète (commande + articles + timeline +
//   ledgers + audit). Lectures service_role (hors RLS) AUTO-GARDÉES par le
//   contexte admin (règle self-guard) : hors domaine → null.
// =============================================================================

export type AdminOrderSearchFilters = {
  q?: string;
  merchantQ?: string;
  driverQ?: string;
  status?: string; // statut exact ou 'active'
  paymentMethod?: "cash" | "online";
  paymentStatus?: "pending" | "paid" | "failed" | "refunded";
  fulfillment?: "pickup" | "delivery";
  deliveryMode?: "express" | "tour";
  from?: string; // ISO
  to?: string; // ISO (exclusif)
  page?: number; // 1-based
  pageSize?: number;
};

export type AdminOrderRow = {
  id: string;
  order_number: string | null;
  status: string;
  fulfillment_type: string | null;
  delivery_mode: string | null;
  payment_method: string;
  payment_status: string;
  total_da: number;
  admin_refunded_da: number;
  customer_name: string | null;
  customer_phone: string | null;
  merchant_id: string;
  merchant_name: string;
  driver_id: string | null;
  driver_name: string | null;
  cancelled_by: string | null;
  delivery_no_show_at: string | null;
  delivery_failed_at: string | null;
  created_at: string;
  total_count: number;
};

export async function searchAdminOrders(
  filters: AdminOrderSearchFilters
): Promise<{ rows: AdminOrderRow[]; total: number }> {
  const supabase = await createClient();
  const pageSize = Math.min(Math.max(filters.pageSize ?? 30, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  // RPC 0338 hors database.types → cast local (pattern rpc bind).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_search_orders", {
    p_q: filters.q?.trim() || null,
    p_merchant_q: filters.merchantQ?.trim() || null,
    p_driver_q: filters.driverQ?.trim() || null,
    p_status: filters.status || null,
    p_payment_method: filters.paymentMethod || null,
    p_payment_status: filters.paymentStatus || null,
    p_fulfillment: filters.fulfillment || null,
    p_delivery_mode: filters.deliveryMode || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) return { rows: [], total: 0 };

  const rows = (
    (data ?? []) as (Omit<AdminOrderRow, "total_count"> & {
      total_count: number | string;
    })[]
  ).map((r) => ({ ...r, total_count: Number(r.total_count) }));
  return { rows, total: rows[0]?.total_count ?? 0 };
}

// -----------------------------------------------------------------------------
// Fiche commande
// -----------------------------------------------------------------------------

export type AdminOrderItem = {
  id: string;
  product_name: string;
  unit_price_da: number;
  quantity: number;
  line_total_da: number;
  unit: string | null;
  is_free: boolean | null;
};

export type AdminOrderEvent = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

export type AdminOrderLedgerRow = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  type: string;
  amount_da: number;
  note: string | null;
  settled_at: string | null;
  created_at: string;
};

export type AdminOrderWalletRow = {
  id: string;
  type: string;
  source: string;
  amount_da: number;
  note: string | null;
  created_at: string;
};

export type AdminOrderAuditRow = {
  id: string;
  admin_email: string | null;
  action: string;
  note: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type AdminCandidateDriver = {
  id: string;
  full_name: string;
  phone: string | null;
};

export type AdminOrderDetail = {
  order: Record<string, unknown> & {
    id: string;
    order_number: string | null;
    status: string;
    fulfillment_type: string | null;
    delivery_mode: string | null;
    payment_method: string;
    payment_status: string;
    total_da: number;
    subtotal_da: number | null;
    discount_da: number | null;
    service_fee_da: number | null;
    delivery_fee_da: number | null;
    cashback_used_da: number | null;
    topup_used_da: number | null;
    admin_refunded_da: number;
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_note: string | null;
    delivery_address_text: string | null;
    delivery_phone: string | null;
    delivery_recipient_name: string | null;
    delivery_driver_id: string | null;
    delivery_picked_up_at: string | null;
    delivery_arrived_at: string | null;
    delivery_delivered_at: string | null;
    delivery_failed_at: string | null;
    delivery_failed_reason: string | null;
    delivery_no_show_at: string | null;
    delivery_no_show_kind: string | null;
    driver_notified_at: string | null;
    driver_claimed_at: string | null;
    marked_ready_at: string | null;
    prep_started_at: string | null;
    cancelled_by: string | null;
    merchant_id: string;
    created_at: string;
  };
  merchantName: string;
  driver: { id: string; full_name: string; phone: string | null } | null;
  items: AdminOrderItem[];
  events: AdminOrderEvent[];
  ledger: AdminOrderLedgerRow[];
  wallet: AdminOrderWalletRow[];
  audit: AdminOrderAuditRow[];
  candidates: AdminCandidateDriver[];
};

export async function getAdminOrderDetail(
  orderId: string
): Promise<AdminOrderDetail | null> {
  // Self-guard service_role : hors domaine → null (fail-closed).
  const ctx = await getAdminContext();
  const allowed =
    ctx.isOwner ||
    ctx.domains.includes("pilotage") ||
    ctx.domains.includes("commercants");
  if (!ctx.isAdmin || !allowed) return null;

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;

  const [
    { data: merchant },
    { data: items },
    { data: events },
    { data: ledger },
    { data: wallet },
    { data: audit },
    { data: candidates },
  ] = await Promise.all([
    admin
      .from("merchants")
      .select("name")
      .eq("id", order.merchant_id)
      .maybeSingle(),
    admin
      .from("order_items")
      .select(
        "id, product_name, unit_price_da, quantity, line_total_da, unit, is_free"
      )
      .eq("order_id", orderId),
    admin
      .from("order_events")
      .select("id, from_status, to_status, note, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    admin
      .from("delivery_ledger")
      .select("id, driver_id, type, amount_da, note, settled_at, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    admin
      .from("customer_wallet_entries")
      .select("id, type, source, amount_da, note, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    admin
      .from("admin_audit_log")
      .select(
        "id, admin_email, action, note, old_value, new_value, ip, created_at"
      )
      .eq("target_kind", "order")
      .eq("target_id", orderId)
      .order("created_at", { ascending: true }),
    admin
      .from("drivers")
      .select("id, full_name, phone")
      .eq("is_frozen", false)
      .eq("is_blocked", false)
      .order("full_name")
      .limit(200),
  ]);

  // Livreur courant + noms des livreurs apparaissant dans le ledger.
  const driverIds = new Set<string>();
  if (order.delivery_driver_id) driverIds.add(order.delivery_driver_id);
  for (const l of ledger ?? []) driverIds.add(l.driver_id);
  const { data: driverRows } = driverIds.size
    ? await admin
        .from("drivers")
        .select("id, full_name, phone")
        .in("id", [...driverIds])
    : { data: [] };
  const driverById = new Map((driverRows ?? []).map((d) => [d.id, d] as const));

  return {
    // Colonnes récentes (admin_refunded_da, no-show…) hors types générés → cast.
    order: order as unknown as AdminOrderDetail["order"],
    merchantName: merchant?.name ?? "—",
    driver: order.delivery_driver_id
      ? (driverById.get(order.delivery_driver_id) ?? null)
      : null,
    items: (items ?? []) as AdminOrderItem[],
    events: (events ?? []) as AdminOrderEvent[],
    ledger: ((ledger ?? []) as Omit<AdminOrderLedgerRow, "driver_name">[]).map(
      (l) => ({
        ...l,
        driver_name: driverById.get(l.driver_id)?.full_name ?? null,
      })
    ),
    wallet: (wallet ?? []) as AdminOrderWalletRow[],
    audit: (audit ?? []) as unknown as AdminOrderAuditRow[],
    candidates: (candidates ?? []) as AdminCandidateDriver[],
  };
}
