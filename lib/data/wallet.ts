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
};

export async function getWalletSummary(): Promise<WalletSummary> {
  const supabase = await createClient();
  // RLS filtre déjà sur le commerçant connecté → toutes ses écritures.
  const { data } = await supabase
    .from("wallet_entries")
    .select("amount_da, type");
  const out: WalletSummary = {
    balance: 0,
    totalSales: 0,
    totalCommission: 0,
    totalServiceFeesOwed: 0,
    totalPaidOut: 0,
  };
  for (const e of data ?? []) {
    out.balance += e.amount_da;
    const t = e.type as WalletEntryType;
    if (t === "sale") out.totalSales += e.amount_da;
    else if (t === "commission") out.totalCommission += e.amount_da;
    else if (t === "service_fee") out.totalServiceFeesOwed += -e.amount_da;
    else if (t === "payout") out.totalPaidOut += e.amount_da;
  }
  return out;
}

/**
 * Page d'écritures (10 par défaut) avec leur jointure orders pour le badge
 * Cash/En ligne. Retourne le total exact pour calculer le nombre de pages.
 */
export async function getWalletEntriesPage(
  page: number,
  pageSize: number
): Promise<{ entries: WalletEntryRow[]; total: number }> {
  const supabase = await createClient();
  const offset = Math.max(0, (page - 1) * pageSize);
  const { data, count } = await supabase
    .from("wallet_entries")
    .select(
      `id, merchant_id, order_id, type, amount_da, commission_rate, note,
       created_at, orders ( payment_method )`,
      { count: "exact" }
    )
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
