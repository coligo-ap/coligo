import { createClient } from "@/lib/supabase/server";
import type { PaymentMethod, PayoutRequest, WalletEntry } from "@/lib/types";

/** Écriture + mode de paiement de la commande liée (pour le badge Cash/En ligne). */
export type WalletEntryRow = WalletEntry & {
  orders: { payment_method: PaymentMethod } | null;
};

/** Écritures du wallet du commerçant connecté (RLS = ses données), récentes d'abord. */
export async function getWalletEntries(): Promise<WalletEntryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wallet_entries")
    .select(
      `id, merchant_id, order_id, type, amount_da, commission_rate, note,
       created_at, orders ( payment_method )`
    )
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []) as unknown as WalletEntryRow[];
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
