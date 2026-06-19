"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentCustomer } from "@/lib/auth/customer";
import {
  getMyTopupBalance,
  getMyTopupHistory,
  getTopupCreditedLast30dForCustomer,
  type CustomerWalletEntry,
} from "@/lib/customer/cashback";
import { getMyPayHandle, type MyPayHandle } from "./qr/actions";

export type ColigoPayData = {
  balance: number;
  remaining30d: number;
  maxPerRecharge: number;
  p2pEnabled: boolean;
  history: CustomerWalletEntry[];
  payTag: MyPayHandle;
};

/**
 * Toutes les données de /coligo-pay en UN appel, pour le loader client TanStack
 * (pattern OrdersLoader). Le RSC de la page ne fait plus que les gardes
 * auth/flag → l'écran s'affiche instantanément, les données arrivent du cache
 * (réutilisé entre navigations) puis se rafraîchissent en silence.
 *
 * Sécurité : ré-authentifié côté serveur (getCurrentCustomer + RLS) ; seules
 * les écritures topup `source='topup'` du client connecté sont renvoyées.
 */
export async function fetchColigoPayData(): Promise<ColigoPayData> {
  const customer = await getCurrentCustomer();
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("platform_settings")
    .select("max_topup_da_per_30d, p2p_enabled")
    .eq("id", true)
    .maybeSingle();
  const maxPerRecharge = settings?.max_topup_da_per_30d ?? 50000;
  // ch.0.10 — P2P désactivé au lancement (réglementation Banque d'Algérie).
  const p2pEnabled = settings?.p2p_enabled ?? false;

  const [balance, credited30d, history, payTag] = await Promise.all([
    getMyTopupBalance(),
    customer
      ? getTopupCreditedLast30dForCustomer(customer.id)
      : Promise.resolve(0),
    getMyTopupHistory(100),
    getMyPayHandle(),
  ]);

  return {
    balance,
    remaining30d: Math.max(0, maxPerRecharge - credited30d),
    maxPerRecharge,
    p2pEnabled,
    history,
    payTag,
  };
}
