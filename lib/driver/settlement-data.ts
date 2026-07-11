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
  /** Agrégats par mode de paiement — filtre client de « Gains et Relevés ».
   *  netDa = gains livreur (driver_payout) ; coligoDa = part Coligo
   *  (driver_fee) sur ces mêmes livraisons. */
  byMethod: {
    all: MethodSlice;
    cash: MethodSlice;
    online: MethodSlice;
  };
};

export type MethodSlice = { count: number; netDa: number; coligoDa: number };

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

/** Période de relevé : bornes ISO [from, to) + libellé affichable. */
export type SettlementPeriod = { from: string; to: string; label: string };

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * Interprète les paramètres d'URL de période (?month=YYYY-MM ou
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD) — PARTAGÉ page relevé + export PDF pour
 * que le document corresponde toujours à l'écran. null = période en cours
 * (écritures non réglées).
 */
export function parseSettlementPeriod(params: {
  month?: string;
  from?: string;
  to?: string;
}): SettlementPeriod | null {
  const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
    const [y, m] = params.month.split("-").map(Number);
    if (m >= 1 && m <= 12) {
      const from = new Date(Date.UTC(y, m - 1, 1));
      const to = new Date(Date.UTC(y, m, 1));
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        label: `${MONTHS_FR[m - 1]} ${y}`,
      };
    }
  }
  if (isDay(params.from) && isDay(params.to)) {
    const from = new Date(`${params.from}T00:00:00Z`);
    // Borne haute INCLUSIVE côté utilisateur → exclusive au lendemain.
    const to = new Date(`${params.to}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    if (from.getTime() < to.getTime()) {
      const fmt = (d: string) => d.split("-").reverse().join("/");
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        label: `du ${fmt(params.from!)} au ${fmt(params.to!)}`,
      };
    }
  }
  return null;
}

export async function getDriverSettlement(
  driverId: string,
  period?: SettlementPeriod | null
): Promise<SettlementData> {
  const supabase = await createClient();

  // Écritures de la période : PAR DÉFAUT = non réglées (règlement en cours) ;
  // avec une période explicite (mois / dates personnalisées) = TOUTES les
  // écritures créées dans [from, to) — relevé historique consultable/PDF.
  let ledgerQuery = supabase
    .from("delivery_ledger")
    .select("order_id, type, amount_da, settled_at, created_at")
    .eq("driver_id", driverId);
  ledgerQuery = period
    ? ledgerQuery.gte("created_at", period.from).lt("created_at", period.to)
    : ledgerQuery.is("settled_at", null);

  const [ledgerRes, profileRes, settingsRes] = await Promise.all([
    ledgerQuery,
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

  // Tranches par mode de paiement (filtre client Tous/Espèces/En ligne).
  const slice = () => ({ count: 0, netDa: 0, coligoDa: 0 });
  const byMethod = { all: slice(), cash: slice(), online: slice() };
  const countedByMethod = {
    cash: new Set<string>(),
    online: new Set<string>(),
  };
  const methodOf = (o: OrderSnap | undefined): "cash" | "online" =>
    o?.payment_method === "online" ? "online" : "cash";

  for (const e of ledger) {
    const o = e.order_id ? orderById.get(e.order_id) : undefined;
    if (e.type === "driver_payout") {
      grossDriver += e.amount_da;
      if (e.order_id) deliveryOrderIds.add(e.order_id);
      const m = methodOf(o);
      byMethod[m].netDa += e.amount_da;
      if (e.order_id) countedByMethod[m].add(e.order_id);
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
  // Part Coligo par tranche : snapshot `driver_fee_da` de CHAQUE livraison de
  // la période (les écritures « owes » n'existent que pour le COD — un calcul
  // par écritures oublierait la part Coligo des livraisons prépayées).
  for (const id of deliveryOrderIds) {
    const o = orderById.get(id);
    byMethod[methodOf(o)].coligoDa += o?.driver_fee_da ?? 0;
  }
  byMethod.cash.count = countedByMethod.cash.size;
  byMethod.online.count = countedByMethod.online.size;
  byMethod.all = {
    count: deliveryOrderIds.size,
    netDa: byMethod.cash.netDa + byMethod.online.netDa,
    coligoDa: byMethod.cash.coligoDa + byMethod.online.coligoDa,
  };

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
    periodLabel: period?.label ?? "période en cours",
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
    // Échéance : seulement pour la période EN COURS (un relevé historique
    // constate, il n'annonce pas de règlement à venir).
    dueLabel: period
      ? null
      : direction === "reverse"
        ? `Règlement ${cycle} · part plateforme encaissée en espèces`
        : direction === "receive"
          ? `Versement au prochain cycle ${cycle}`
          : null,
    byMethod,
  };
}

/**
 * Premier mois d'activité du livreur (YYYY-MM) — borne le sélecteur de
 * période : un livreur qui travaille depuis des mois/années voit TOUS ses
 * mois, groupés par année.
 */
export async function getDriverFirstActivityMonth(
  driverId: string
): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("delivery_ledger")
    .select("created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? String(data.created_at).slice(0, 7) : null;
}
