import { createClient } from "@/lib/supabase/server";

/**
 * Données du RELEVÉ · règlement du livreur — SOURCE UNIQUE partagée par la
 * page /driver/releve et l'export PDF /api/pdf/releve (plus de duplication).
 * Agrège en LIVE les écritures `delivery_ledger` NON réglées
 * (settled_at IS NULL) + les snapshots `orders` pour le détail (commission /
 * frais de service / part Coligo). Le sens du solde est calculé exactement
 * comme la RPC `generate_driver_statements` (cf. docs/livreur-paiement.md).
 * (Distinct de lib/driver/settlement.ts = calculs purs par commande.)
 */

export type SettlementData = {
  periodLabel: string;
  deliveriesCount: number;
  grossDriverDa: number;
  commissionDa: number;
  serviceFeeDa: number;
  driverFeeDa: number;
  toReverseDa: number;
  toReceiveDa: number;
  netDa: number;
  direction: "reverse" | "receive" | "settled";
  driverFeeRatePct: number;
  method: string | null;
  details: string | null;
  dueLabel: string | null;
};

type LedgerRow = {
  order_id: string | null;
  type: string;
  amount_da: number;
};
type OrderSnap = {
  id: string;
  payment_method: "cash" | "online";
  commission_da: number | null;
  service_fee_da: number | null;
  driver_fee_da: number | null;
  delivery_failed_at: string | null;
};

export async function getDriverSettlement(
  driverId: string
): Promise<SettlementData> {
  const supabase = await createClient();

  // Écritures non réglées + config + profil versement.
  const [ledgerRes, profileRes, settingsRes] = await Promise.all([
    supabase
      .from("delivery_ledger")
      .select("order_id, type, amount_da, settled_at")
      .eq("driver_id", driverId)
      .is("settled_at", null),
    supabase
      .from("drivers")
      .select("payout_method, payout_details")
      .eq("id", driverId)
      .single(),
    supabase
      .from("platform_settings")
      .select("driver_fee_rate, driver_settlement_cycle")
      .eq("id", true)
      .single(),
  ]);

  const ledger = (ledgerRes.data ?? []) as LedgerRow[];
  const orderIds = Array.from(
    new Set(ledger.map((l) => l.order_id).filter((x): x is string => !!x))
  );

  let orders: OrderSnap[] = [];
  if (orderIds.length > 0) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, payment_method, commission_da, service_fee_da, driver_fee_da, delivery_failed_at"
      )
      .in("id", orderIds);
    orders = (data ?? []) as OrderSnap[];
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // Agrégation (miroir de generate_driver_statements).
  let grossDriver = 0;
  let toReverse = 0;
  let toReceive = 0;
  let commission = 0;
  let serviceFee = 0;
  let driverFee = 0;
  const deliveryOrderIds = new Set<string>();

  for (const e of ledger) {
    const o = e.order_id ? orderById.get(e.order_id) : undefined;
    if (e.type === "driver_payout") {
      grossDriver += e.amount_da;
      if (e.order_id) deliveryOrderIds.add(e.order_id);
      // « À recevoir » : prépayé OU no-show (la plateforme doit au livreur).
      if (o?.payment_method === "online" || o?.delivery_failed_at) {
        toReceive += e.amount_da;
      }
    } else if (e.type === "driver_advance_refund") {
      // Avance no-show remboursée par la plateforme (validée par le support).
      toReceive += e.amount_da;
    } else if (e.type === "driver_owes_platform") {
      toReverse += e.amount_da;
      commission += o?.commission_da ?? 0;
      serviceFee += o?.service_fee_da ?? 0;
      driverFee += o?.driver_fee_da ?? 0;
    }
  }

  const netDa = toReceive - toReverse;
  const direction: SettlementData["direction"] =
    netDa > 0 ? "receive" : netDa < 0 ? "reverse" : "settled";

  const profile = (profileRes.data ?? {}) as {
    payout_method?: string | null;
    payout_details?: string | null;
  };
  const settings = (settingsRes.data ?? {}) as {
    driver_fee_rate?: number;
    driver_settlement_cycle?: string;
  };
  const cycle =
    settings.driver_settlement_cycle === "monthly" ? "mensuel" : "hebdo";

  return {
    periodLabel: "période en cours",
    deliveriesCount: deliveryOrderIds.size,
    grossDriverDa: grossDriver,
    commissionDa: commission,
    serviceFeeDa: serviceFee,
    driverFeeDa: driverFee,
    toReverseDa: toReverse,
    toReceiveDa: toReceive,
    netDa,
    direction,
    driverFeeRatePct: Math.round((settings.driver_fee_rate ?? 0.08) * 100),
    method: profile.payout_method ?? null,
    details: profile.payout_details ?? null,
    dueLabel:
      direction === "reverse"
        ? `Règlement ${cycle} · part plateforme encaissée en espèces`
        : direction === "receive"
          ? `Versement au prochain cycle ${cycle}`
          : null,
  };
}
