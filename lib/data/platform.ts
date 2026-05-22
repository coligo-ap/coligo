import { createClient } from "@/lib/supabase/server";
import type { PlatformSettings } from "@/lib/types";

/** Taux globaux (ligne unique). Lisible par tout authentifié (RLS). */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select(
      "commission_cash, commission_online, cashback_online, cashback_cash, chargily_fee, max_debt_da, updated_at"
    )
    .eq("id", true)
    .maybeSingle();
  return (data as PlatformSettings | null) ?? null;
}

export type AdminMerchant = {
  id: string;
  name: string;
  city: string | null;
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
      "id, name, city, is_active, is_frozen, commission_cash, commission_online, cashback_online, cashback_cash"
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
