import { createClient } from "@/lib/supabase/server";
import type {
  PaymentMethod,
  PayoutRequest,
  WalletEntry,
  WalletEntryType,
} from "@/lib/types";

/** Écriture + mode de paiement de la commande liée (badge Cash/En ligne). */
export type WalletEntryRow = WalletEntry & {
  orders: { payment_method: PaymentMethod } | null;
  /** Non-null si l'écriture provient d'un encaissement Coligo Pay (QR). */
  coligo_pay_payment_id: string | null;
};

/**
 * Résumé du wallet — solde + totaux par type — calculé à partir d'une requête
 * légère (seulement `amount_da` + `type`). Pas de jointure : on évite le coût
 * réseau d'amener toutes les commandes liées.
 */
export type WalletSummary = {
  balance: number;
  totalSales: number;
  totalCommission: number;
  /**
   * Frais de service encaissés en cash pour la plateforme : montant positif que
   * le commerçant doit reverser. Stocké comme valeur négative dans le ledger,
   * exposé en positif ici pour l'affichage.
   */
  totalServiceFeesOwed: number;
  totalPaidOut: number;
  /** Ventes encaissées via Coligo Pay (QR en magasin). */
  coligoPayCollected: number;
  /** Ventes encaissées en ligne (Chargily) = totalSales − Coligo Pay. */
  onlineCollected: number;
  /** Revenu livraison tournée encaissé pour le commerçant (online). */
  deliveryRevenue: number;
  /** Commission Coligo sur les livraisons de tournée (positif = dû). */
  tourDeliveryCommission: number;
  /** Cashback / Coligo Pay du client reversé au commerçant (cash). */
  walletRedemption: number;
  /** Ajustements manuels (peut être ±). */
  adjustments: number;
};

export async function getWalletSummary(): Promise<WalletSummary> {
  const supabase = await createClient();
  // RLS filtre déjà sur le commerçant connecté → toutes ses écritures.
  const { data } = await supabase
    .from("wallet_entries")
    .select("amount_da, type, coligo_pay_payment_id");
  const out: WalletSummary = {
    balance: 0,
    totalSales: 0,
    totalCommission: 0,
    totalServiceFeesOwed: 0,
    totalPaidOut: 0,
    coligoPayCollected: 0,
    onlineCollected: 0,
    deliveryRevenue: 0,
    tourDeliveryCommission: 0,
    walletRedemption: 0,
    adjustments: 0,
  };
  for (const e of data ?? []) {
    out.balance += e.amount_da;
    const t = e.type as WalletEntryType;
    if (t === "sale") {
      out.totalSales += e.amount_da;
      // Une vente provient soit d'un encaissement Coligo Pay (lien non-null),
      // soit d'une commande en ligne (Chargily). Le cash ne crée PAS de "sale".
      if (
        (e as { coligo_pay_payment_id: string | null }).coligo_pay_payment_id
      ) {
        out.coligoPayCollected += e.amount_da;
      } else {
        out.onlineCollected += e.amount_da;
      }
    } else if (t === "commission") out.totalCommission += e.amount_da;
    else if (t === "service_fee" || t === "service_fee_owed")
      out.totalServiceFeesOwed += -e.amount_da;
    else if (t === "payout") out.totalPaidOut += e.amount_da;
    else if (t === "delivery_revenue") out.deliveryRevenue += e.amount_da;
    else if (t === "tour_delivery_commission")
      out.tourDeliveryCommission += -e.amount_da;
    else if (t === "wallet_redemption") out.walletRedemption += e.amount_da;
    else if (t === "adjustment") out.adjustments += e.amount_da;
  }
  return out;
}

/**
 * Page d'écritures (10 par défaut) avec leur jointure orders pour le badge
 * Cash/En ligne. Retourne le total exact pour calculer le nombre de pages.
 */
export async function getWalletEntriesPage(
  page: number,
  pageSize: number,
  // Filtres TRAÇABLES (type d'écriture + période ISO [from, to) + recherche
  // libre) — appliqués CÔTÉ REQUÊTE (pagination juste) ; RLS = toujours le
  // commerçant connecté.
  filters?: {
    type?: string | null;
    from?: string | null;
    to?: string | null;
    q?: string | null;
  }
): Promise<{ entries: WalletEntryRow[]; total: number }> {
  const supabase = await createClient();
  const offset = Math.max(0, (page - 1) * pageSize);
  let q = supabase.from("wallet_entries").select(
    `id, merchant_id, order_id, type, amount_da, commission_rate, note,
       created_at, coligo_pay_payment_id, orders ( payment_method )`,
    { count: "exact" }
  );
  // Cast : l'enum généré est en retard sur la DB (types ajoutés depuis :
  // tour_delivery_commission, wallet_redemption…) ; la valeur vient d'une
  // liste UI fermée et la RLS scope de toute façon le commerçant.
  if (filters?.type) q = q.eq("type", filters.type as never);
  if (filters?.from) q = q.gte("created_at", filters.from);
  if (filters?.to) q = q.lt("created_at", filters.to);
  // Recherche : note OU n° de commande. Le n° passe par une pré-requête orders
  // scopée EXPLICITEMENT au commerçant (jamais la RLS seule) → liste d'ids.
  // Caractères spéciaux PostgREST retirés (le `.or()` est une mini-grammaire).
  const needle = (filters?.q ?? "").replace(/["%*,()\\]/g, " ").trim();
  if (needle) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = user
      ? await supabase
          .from("merchants")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle()
      : { data: null };
    let orderIds: string[] = [];
    if (me) {
      const { data: ords } = await supabase
        .from("orders")
        .select("id")
        .eq("merchant_id", me.id)
        .ilike("order_number", `%${needle}%`)
        .limit(200);
      orderIds = ((ords ?? []) as { id: string }[]).map((o) => o.id);
    }
    const parts = [`note.ilike."*${needle}*"`];
    if (orderIds.length) parts.push(`order_id.in.(${orderIds.join(",")})`);
    q = q.or(parts.join(","));
  }
  const { data, count } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);
  return {
    entries: (data ?? []) as unknown as WalletEntryRow[],
    total: count ?? 0,
  };
}

/** Demandes de versement du commerçant connecté (RLS), récentes d'abord. */
export async function getPayoutRequests(): Promise<PayoutRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payout_requests")
    .select(
      "id, merchant_id, amount_da, status, method, details, processed_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as PayoutRequest[];
}
