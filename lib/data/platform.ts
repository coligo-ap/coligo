import { createClient } from "@/lib/supabase/server";
import type { PlatformSettings, OrderStatus } from "@/lib/types";

/** Taux globaux (ligne unique). Lisible par tout authentifié (RLS). */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select(
      `commission_cash, commission_online, cashback_online, cashback_cash,
       chargily_fee, max_debt_da,
       delivery_base_da, delivery_per_km_da, delivery_free_km_threshold,
       delivery_min_da, delivery_max_da, delivery_max_radius_km,
       updated_at`
    )
    .eq("id", true)
    .maybeSingle();
  return (data as PlatformSettings | null) ?? null;
}

export type AdminMerchant = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  is_active: boolean;
  is_frozen: boolean;
  commission_cash: number | null;
  commission_online: number | null;
  cashback_online: number | null;
  cashback_cash: number | null;
  balance: number;
};

/**
 * Tous les commerçants pour l'admin (RLS : is_super_admin), avec leur solde
 * (SUM du ledger). Le solde négatif = dette de commissions (cash).
 */
export async function getAllMerchantsForAdmin(): Promise<AdminMerchant[]> {
  const supabase = await createClient();
  const { data: merchants } = await supabase
    .from("merchants")
    .select(
      "id, name, city, category, is_active, is_frozen, commission_cash, commission_online, cashback_online, cashback_cash"
    )
    .order("created_at", { ascending: true });

  if (!merchants) return [];

  // Solde par commerçant : on agrège les écritures visibles (RLS admin).
  const { data: entries } = await supabase
    .from("wallet_entries")
    .select("merchant_id, amount_da");

  const balances = new Map<string, number>();
  for (const e of entries ?? []) {
    balances.set(
      e.merchant_id,
      (balances.get(e.merchant_id) ?? 0) + e.amount_da
    );
  }

  return merchants.map((m) => ({
    ...m,
    balance: balances.get(m.id) ?? 0,
  }));
}

// =============================================================================
// TABLEAU DE BORD SUPER-ADMIN — chiffres plateforme (RPC SECURITY DEFINER)
// =============================================================================

export type PlatformDashboard = {
  merchants_total: number;
  merchants_active: number;
  merchants_sold: number;
  orders_completed: number;
  gmv_da: number;
  net_profit_da: number;
  commission_income_da: number;
  service_fee_income_da: number;
  tour_delivery_commission_income_da: number;
  chargily_fee_da: number;
  cashback_expense_da: number;
  online_orders: number;
  online_net_da: number;
  delivery_orders: number;
  delivery_fees_da: number;
  express_delivery_fees_da: number;
  driver_payouts_da: number;
  cashback_earned_da: number;
  cashback_spent_da: number;
  cashback_outstanding_da: number;
  topup_outstanding_da: number;
};

// Les fonctions de la mig 0072 ne sont pas (encore) dans database.types.ts
// générés : on cast le NOM (`as never`) mais on garde l'appel METHODE
// supabase.rpc(…) pour conserver le binding `this` (sinon throw à l'exécution).

/** KPIs globaux plateforme (bénéfice, CA, cashback…). RLS : is_super_admin. */
export async function getPlatformDashboard(): Promise<PlatformDashboard | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "platform_dashboard_stats" as never
  );
  if (error || !data) return null;
  const d = data as unknown as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    merchants_total: n("merchants_total"),
    merchants_active: n("merchants_active"),
    merchants_sold: n("merchants_sold"),
    orders_completed: n("orders_completed"),
    gmv_da: n("gmv_da"),
    net_profit_da: n("net_profit_da"),
    commission_income_da: n("commission_income_da"),
    service_fee_income_da: n("service_fee_income_da"),
    tour_delivery_commission_income_da: n("tour_delivery_commission_income_da"),
    chargily_fee_da: n("chargily_fee_da"),
    cashback_expense_da: n("cashback_expense_da"),
    online_orders: n("online_orders"),
    online_net_da: n("online_net_da"),
    delivery_orders: n("delivery_orders"),
    delivery_fees_da: n("delivery_fees_da"),
    express_delivery_fees_da: n("express_delivery_fees_da"),
    driver_payouts_da: n("driver_payouts_da"),
    cashback_earned_da: n("cashback_earned_da"),
    cashback_spent_da: n("cashback_spent_da"),
    cashback_outstanding_da: n("cashback_outstanding_da"),
    topup_outstanding_da: n("topup_outstanding_da"),
  };
}

export type AdminMerchantRow = {
  id: string;
  name: string;
  city: string | null;
  is_active: boolean;
  is_frozen: boolean;
  completed_orders: number;
  gmv_da: number;
  commission_da: number;
  balance_da: number;
};

/** Détail par commerçant (CA, commission, solde), trié par CA décroissant. */
export async function getMerchantRowsForAdmin(): Promise<AdminMerchantRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_merchant_rows" as never);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? "Commerce"),
    city: (r.city as string | null) ?? null,
    is_active: !!r.is_active,
    is_frozen: !!r.is_frozen,
    completed_orders: Number(r.completed_orders ?? 0),
    gmv_da: Number(r.gmv_da ?? 0),
    commission_da: Number(r.commission_da ?? 0),
    balance_da: Number(r.balance_da ?? 0),
  }));
}

// =============================================================================
// ALERTES SUPER-ADMIN — commandes en retard
// =============================================================================
// Une commande est « en retard » pour l'admin quand elle est encore ACTIVE
// (non terminée/annulée) et que son heure prévue (pickup_slot_at) est dépassée
// de plus de LATE_ALERT_THRESHOLD_MIN minutes. On exclut les commandes online
// non payées (le client a abandonné le paiement — ce n'est pas un retard
// commerçant), cohérent avec le gating mig 0068.

/** Seuil (min) au-delà duquel une commande active alerte le super-admin. */
export const LATE_ALERT_THRESHOLD_MIN = 30;

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
];

export type AdminLateOrder = {
  id: string;
  order_number: string | null;
  pickup_code: string | null;
  status: OrderStatus;
  created_at: string;
  pickup_slot_at: string;
  total_da: number | null;
  payment_method: "cash" | "online";
  payment_status: string | null;
  fulfillment_type: "pickup" | "delivery";
  delivery_mode: "express" | "tour" | null;
  customer_name: string | null;
  customer_phone: string | null;
  merchant_id: string;
  merchant_name: string;
  merchant_city: string | null;
  merchant_phone: string | null;
  merchant_manager: string | null;
};

type MerchantJoin = {
  name: string;
  city: string | null;
  phone_public: string | null;
  manager_name: string | null;
} | null;

// Filtre commun (chaîné APRÈS .select()) : commandes actives, en retard, et
// réellement effectives (cash, ou online déjà payé — on exclut l'online non
// payé, cohérent avec le gating mig 0068).
const PAID_OR_CASH =
  "payment_method.eq.cash,and(payment_method.eq.online,payment_status.eq.paid)";

/** Commandes en retard (toutes enseignes) pour la page Alertes super-admin. */
export async function getLateOrdersForAdmin(
  thresholdMin = LATE_ALERT_THRESHOLD_MIN
): Promise<AdminLateOrder[]> {
  const supabase = await createClient();
  const cutoffIso = new Date(Date.now() - thresholdMin * 60_000).toISOString();
  const { data } = await supabase
    .from("orders")
    .select(
      `id, order_number, pickup_code, status, created_at, pickup_slot_at,
       total_da, payment_method, payment_status, fulfillment_type, delivery_mode,
       customer_name, customer_phone, merchant_id,
       merchants ( name, city, phone_public, manager_name )`
    )
    .in("status", ACTIVE_STATUSES)
    .lt("pickup_slot_at", cutoffIso)
    .or(PAID_OR_CASH)
    .order("pickup_slot_at", { ascending: true })
    .limit(200);

  return (data ?? []).map((o) => {
    const m = (o as unknown as { merchants: MerchantJoin }).merchants;
    return {
      id: o.id,
      order_number: o.order_number ?? null,
      pickup_code: o.pickup_code ?? null,
      status: o.status as OrderStatus,
      created_at: o.created_at,
      pickup_slot_at: o.pickup_slot_at,
      total_da: o.total_da,
      payment_method: (o.payment_method ?? "cash") as "cash" | "online",
      payment_status: o.payment_status ?? null,
      fulfillment_type: (o.fulfillment_type ?? "pickup") as
        | "pickup"
        | "delivery",
      delivery_mode: (o.delivery_mode ?? null) as "express" | "tour" | null,
      customer_name: o.customer_name ?? null,
      customer_phone: o.customer_phone ?? null,
      merchant_id: o.merchant_id,
      merchant_name: m?.name ?? "Commerce",
      merchant_city: m?.city ?? null,
      merchant_phone: m?.phone_public ?? null,
      merchant_manager: m?.manager_name ?? null,
    };
  });
}

/** Nombre de commandes en retard (pour le badge de la nav admin). */
export async function getLateOrdersCountForAdmin(
  thresholdMin = LATE_ALERT_THRESHOLD_MIN
): Promise<number> {
  const supabase = await createClient();
  const cutoffIso = new Date(Date.now() - thresholdMin * 60_000).toISOString();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE_STATUSES)
    .lt("pickup_slot_at", cutoffIso)
    .or(PAID_OR_CASH);
  return count ?? 0;
}
