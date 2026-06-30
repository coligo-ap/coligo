// =============================================================================
// Wallet client — accès au solde cashback + historique.
// =============================================================================
// Côté SERVEUR uniquement (lit via RLS = le client connecté ne voit que SES
// écritures). Le solde n'est jamais stocké : on calcule via la fonction SQL
// `customer_cashback_balance(p_customer_id)`.

import { createClient } from "@/lib/supabase/server";

export type CustomerWalletEntry = {
  id: string;
  order_id: string | null;
  type:
    | "cashback_earned"
    | "cashback_spent"
    | "adjustment"
    | "topup_credit"
    | "topup_spent"
    | "voucher_credit"
    | "transfer_in"
    | "transfer_out";
  source: "cashback" | "topup";
  amount_da: number;
  note: string | null;
  created_at: string;
};

/**
 * Renvoie le solde cashback (en DA) du client connecté.
 * 0 si pas de session, pas de profil client, ou aucune écriture.
 */
export async function getMyCashbackBalance(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return 0;

  // La fonction est `STABLE` côté Postgres : on l'appelle via RPC.
  const { data } = await supabase.rpc("customer_cashback_balance", {
    p_customer_id: customer.id,
  });
  return typeof data === "number" ? data : 0;
}

/**
 * Solde cashback d'un customer_id donné (pour les Server Actions qui ont
 * déjà résolu le customer). RLS-safe : la fonction SQL est SECURITY INVOKER,
 * donc respecte la session courante.
 */
export async function getCashbackBalanceForCustomer(
  customerId: string
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_cashback_balance", {
    p_customer_id: customerId,
  });
  return typeof data === "number" ? data : 0;
}

/**
 * Solde Coligo Pay (topup) du client connecté.
 */
export async function getMyTopupBalance(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return 0;
  const { data } = await supabase.rpc("customer_topup_balance", {
    p_customer_id: customer.id,
  });
  return typeof data === "number" ? data : 0;
}

/**
 * Solde topup d'un customer_id donné (pour les Server Actions).
 */
export async function getTopupBalanceForCustomer(
  customerId: string
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_topup_balance", {
    p_customer_id: customerId,
  });
  return typeof data === "number" ? data : 0;
}

/**
 * Cumul des recharges topup créditées sur les 30 derniers jours (pour vérifier
 * le plafond glissant côté Server Action).
 */
export async function getTopupCreditedLast30dForCustomer(
  customerId: string
): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_topup_credited_last_30d", {
    p_customer_id: customerId,
  });
  return typeof data === "number" ? data : 0;
}

/**
 * Historique CASHBACK uniquement du client connecté (récentes en premier).
 * Filtre `source = 'cashback'` pour ne pas mélanger avec les écritures topup
 * (Coligo Pay) — chacun a sa page dédiée côté client.
 */
export async function getMyCashbackHistory(
  limit = 100
): Promise<CustomerWalletEntry[]> {
  return getMyWalletHistory("cashback", limit);
}

/**
 * Historique COLIGO PAY (topup) uniquement du client connecté.
 */
export async function getMyTopupHistory(
  limit = 100
): Promise<CustomerWalletEntry[]> {
  return getMyWalletHistory("topup", limit);
}

async function getMyWalletHistory(
  source: "cashback" | "topup",
  limit: number
): Promise<CustomerWalletEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return [];

  const { data } = await supabase
    .from("customer_wallet_entries")
    .select("id, order_id, type, source, amount_da, note, created_at")
    .eq("customer_id", customer.id)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as CustomerWalletEntry[];
}
