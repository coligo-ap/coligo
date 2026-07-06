import { createClient } from "@/lib/supabase/server";
import type { PayoutRequest, WalletEntryType } from "@/lib/types";

// =============================================================================
// Relevés PAR VERSEMENT du commerçant (façon Uber Eats / Shopify Payments).
// =============================================================================
// Chaque versement PAYÉ couvre une période : de la date du versement payé
// précédent (exclu) à sa propre date de paiement (incluse). L'écriture
// `payout` du grand livre est créée dans la MÊME transaction que
// `processed_at = now()` (mig 0271) → les bornes `processed_at` découpent le
// grand livre sans trou ni recouvrement. La facture d'un versement agrège
// l'activité de sa période et se réconcilie avec le solde (report compris).
// =============================================================================

/** Écriture minimale du grand livre pour le découpage par période. */
type LedgerRow = {
  order_id: string | null;
  type: WalletEntryType;
  amount_da: number;
  created_at: string;
};

export type PayoutHistoryItem = PayoutRequest & {
  /** Rang chronologique parmi les versements payés (1 = premier). Null si non payé. */
  seq: number | null;
  /** N° de facture lisible (versements payés uniquement). */
  invoiceNumber: string | null;
  /** Début de période couverte (exclu) — null pour le tout premier versement. */
  periodFrom: string | null;
  /** Fin de période couverte = processed_at (versements payés uniquement). */
  periodTo: string | null;
  /** Commandes distinctes touchées par la période couverte. */
  ordersCount: number;
};

/** Date effective d'un versement payé (processed_at, repli created_at). */
function paidAt(p: PayoutRequest): string {
  return p.processed_at ?? p.created_at;
}

/** Types d'écritures « primaires » d'une commande (≠ ajustement ultérieur). */
const PRIMARY_TYPES: ReadonlySet<string> = new Set([
  "sale",
  "commission",
  "service_fee",
  "service_fee_owed",
  "delivery_revenue",
  "tour_delivery_commission",
  "wallet_redemption",
]);

function inWindow(iso: string, from: string | null, to: string): boolean {
  return (from === null || iso > from) && iso <= to;
}

/** N° de facture : séquentiel lisible + année du paiement (ex. CV-2026-0004). */
function invoiceNumberFor(seq: number, paidIso: string): string {
  return `CV-${paidIso.slice(0, 4)}-${String(seq).padStart(4, "0")}`;
}

/**
 * Historique des versements du commerçant connecté (RLS), récents d'abord,
 * enrichi pour les versements payés : n° de facture, période couverte et
 * nombre de commandes concernées.
 */
export async function getPayoutHistory(): Promise<PayoutHistoryItem[]> {
  const supabase = await createClient();
  const [{ data: reqs }, { data: ledger }] = await Promise.all([
    supabase
      .from("payout_requests")
      .select(
        "id, merchant_id, amount_da, status, method, details, processed_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("wallet_entries")
      .select("order_id, type, amount_da, created_at"),
  ]);
  const requests = (reqs ?? []) as PayoutRequest[];
  const rows = (ledger ?? []) as LedgerRow[];

  // Versements payés en ordre chronologique → fenêtres [prev, this].
  const paid = requests
    .filter((r) => r.status === "paid")
    .sort(
      (a, b) => paidAt(a).localeCompare(paidAt(b)) || (a.id < b.id ? -1 : 1)
    );

  const enrich = new Map<
    string,
    { seq: number; from: string | null; to: string; ordersCount: number }
  >();
  paid.forEach((p, i) => {
    const from = i > 0 ? paidAt(paid[i - 1]) : null;
    const to = paidAt(p);
    const orders = new Set<string>();
    for (const e of rows) {
      if (e.order_id && e.type !== "payout" && inWindow(e.created_at, from, to))
        orders.add(e.order_id);
    }
    enrich.set(p.id, { seq: i + 1, from, to, ordersCount: orders.size });
  });

  return requests.map((r) => {
    const x = enrich.get(r.id);
    return {
      ...r,
      seq: x?.seq ?? null,
      invoiceNumber: x ? invoiceNumberFor(x.seq, x.to) : null,
      periodFrom: x?.from ?? null,
      periodTo: x?.to ?? null,
      ordersCount: x?.ordersCount ?? 0,
    };
  });
}

/* ───────────────────────── Relevé détaillé d'un versement ───────────────────────── */

export type PayoutOrderLine = {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string | null;
  paymentMethod: "cash" | "online";
  /** Produits facturés (net après remises) — 0 si la ligne n'existe dans cette
   *  période que via un ajustement/remboursement (commande d'une période passée). */
  productsDa: number;
  deliveryFeeDa: number;
  /** Part Coligo (commission produits + commission livraison tournée), positif. */
  commissionDa: number;
  /** Frais de service Coligo, positif. */
  serviceFeeDa: number;
  /** Remboursements / ajustements liés à la commande (±). */
  refundsDa: number;
  /** Mouvement net du grand livre pour cette commande sur la période (±). */
  netDa: number;
};

export type PayoutStatement = {
  payout: PayoutRequest;
  seq: number;
  invoiceNumber: string;
  /** Référence courte unique (id du versement). */
  reference: string;
  periodFrom: string | null;
  periodTo: string;
  ordersCount: number;
  totals: {
    /** Chiffre d'affaires produits (toutes commandes de la période). */
    salesDa: number;
    /** Frais de livraison payés par les clients sur ces commandes. */
    deliveryFeesDa: number;
    /** Commissions Coligo (produits + livraison tournée), positif. */
    commissionDa: number;
    /** Frais de service Coligo, positif. */
    serviceFeesDa: number;
    /** Remboursements & ajustements de la période (±, commandes liées ou non). */
    adjustmentsDa: number;
    /** Taxes — 0 aujourd'hui (aucune taxe collectée par la plateforme). */
    taxesDa: number;
    /** Net du grand livre sur la période (hors versements). */
    netActivityDa: number;
    /** Solde Coligo Pay reporté au début de la période. */
    openingBalanceDa: number;
    /** Montant net versé (le versement lui-même). */
    paidDa: number;
    /** Solde après versement = report + activité − versé. */
    closingBalanceDa: number;
  };
  orders: PayoutOrderLine[];
  merchant: {
    name: string;
    address: string | null;
    commune: string | null;
    city: string | null;
    phone: string | null;
  };
  generatedAtLabel: string;
  periodLabel: string;
};

const LONG_DATE = new Intl.DateTimeFormat("fr-DZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Africa/Algiers",
});

type OrderRow = {
  id: string;
  order_number: string | null;
  created_at: string;
  customer_name: string | null;
  payment_method: "cash" | "online";
  net_total_da: number | null;
  total_da: number | null;
  delivery_fee_da: number | null;
};

/**
 * Relevé complet d'un versement PAYÉ du commerçant connecté (RLS) : totaux de
 * la période couverte, réconciliation de solde et détail par commande. Null si
 * versement introuvable / pas encore payé.
 */
export async function getPayoutStatement(
  payoutId: string
): Promise<PayoutStatement | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: reqs }, { data: ledger }, { data: merchant }] =
    await Promise.all([
      supabase
        .from("payout_requests")
        .select(
          "id, merchant_id, amount_da, status, method, details, processed_at, created_at"
        )
        .eq("status", "paid"),
      supabase
        .from("wallet_entries")
        .select("order_id, type, amount_da, created_at"),
      supabase
        .from("merchants")
        .select("name, address, commune, city, phone_public")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const paid = ((reqs ?? []) as PayoutRequest[]).sort(
    (a, b) => paidAt(a).localeCompare(paidAt(b)) || (a.id < b.id ? -1 : 1)
  );
  const idx = paid.findIndex((p) => p.id === payoutId);
  if (idx === -1) return null;

  const payout = paid[idx];
  const from = idx > 0 ? paidAt(paid[idx - 1]) : null;
  const to = paidAt(payout);
  const rows = (ledger ?? []) as LedgerRow[];

  // Solde reporté = cumul de TOUTES les écritures antérieures à la période
  // (versements passés compris) ; activité = écritures de la période hors
  // versement → réconciliation exacte : report + activité − versé = solde après.
  let opening = 0;
  let netActivity = 0;
  let adjustments = 0;
  const periodRows: LedgerRow[] = [];
  for (const e of rows) {
    if (from !== null && e.created_at <= from) {
      opening += e.amount_da;
    } else if (inWindow(e.created_at, from, to) && e.type !== "payout") {
      periodRows.push(e);
      netActivity += e.amount_da;
      if (e.type === "adjustment") adjustments += e.amount_da;
    }
  }

  // Commandes de la période + leurs écritures groupées.
  const byOrder = new Map<string, LedgerRow[]>();
  for (const e of periodRows) {
    if (!e.order_id) continue;
    const slot = byOrder.get(e.order_id);
    if (slot) slot.push(e);
    else byOrder.set(e.order_id, [e]);
  }

  // Jointure orders par lots (éviter un .in() démesuré sur une grosse période).
  const orderIds = [...byOrder.keys()];
  const orderRows: OrderRow[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, order_number, created_at, customer_name, payment_method, net_total_da, total_da, delivery_fee_da"
      )
      .in("id", orderIds.slice(i, i + 200));
    // Cast : le fichier de types généré est en retard sur la DB
    // (net_total_da/gross_total_da ajoutés depuis) ; RLS scope le commerçant.
    orderRows.push(...((data ?? []) as unknown as OrderRow[]));
  }
  const orderById = new Map(orderRows.map((o) => [o.id, o]));

  let salesDa = 0;
  let deliveryFeesDa = 0;
  let commissionDa = 0;
  let serviceFeesDa = 0;
  const lines: PayoutOrderLine[] = [];
  for (const [orderId, entries] of byOrder) {
    const o = orderById.get(orderId);
    // Une commande ne compte dans le CA que si sa vente/commission tombe dans
    // CETTE période ; un simple remboursement tardif ne re-compte pas le CA.
    const hasPrimary = entries.some((e) => PRIMARY_TYPES.has(e.type));
    let commission = 0;
    let serviceFee = 0;
    let refunds = 0;
    let net = 0;
    for (const e of entries) {
      net += e.amount_da;
      if (e.type === "commission" || e.type === "tour_delivery_commission")
        commission += -e.amount_da;
      else if (e.type === "service_fee" || e.type === "service_fee_owed")
        serviceFee += -e.amount_da;
      else if (e.type === "adjustment") refunds += e.amount_da;
    }
    const products = hasPrimary ? (o?.net_total_da ?? o?.total_da ?? 0) : 0;
    const deliveryFee = hasPrimary ? (o?.delivery_fee_da ?? 0) : 0;
    salesDa += products;
    deliveryFeesDa += deliveryFee;
    commissionDa += commission;
    serviceFeesDa += serviceFee;
    lines.push({
      id: orderId,
      orderNumber: o?.order_number ?? "—",
      createdAt: o?.created_at ?? entries[0].created_at,
      customerName: o?.customer_name ?? null,
      paymentMethod: o?.payment_method ?? "cash",
      productsDa: products,
      deliveryFeeDa: deliveryFee,
      commissionDa: commission,
      serviceFeeDa: serviceFee,
      refundsDa: refunds,
      netDa: net,
    });
  }
  lines.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const periodLabel = from
    ? `du ${LONG_DATE.format(new Date(from))} au ${LONG_DATE.format(new Date(to))}`
    : `jusqu'au ${LONG_DATE.format(new Date(to))}`;

  return {
    payout,
    seq: idx + 1,
    invoiceNumber: invoiceNumberFor(idx + 1, to),
    reference: payout.id.slice(0, 8).toUpperCase(),
    periodFrom: from,
    periodTo: to,
    ordersCount: byOrder.size,
    totals: {
      salesDa,
      deliveryFeesDa,
      commissionDa,
      serviceFeesDa,
      adjustmentsDa: adjustments,
      taxesDa: 0,
      netActivityDa: netActivity,
      openingBalanceDa: opening,
      paidDa: payout.amount_da,
      closingBalanceDa: opening + netActivity - payout.amount_da,
    },
    orders: lines,
    merchant: {
      name: merchant?.name ?? "Mon commerce",
      address: merchant?.address ?? null,
      commune: merchant?.commune ?? null,
      city: merchant?.city ?? null,
      phone: merchant?.phone_public ?? null,
    },
    generatedAtLabel: LONG_DATE.format(new Date()),
    periodLabel,
  };
}
