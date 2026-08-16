"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/auth/admin";

export type LoyaltyBoundsResult = { error?: string; ok?: boolean };

function readNum(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Bornes plateforme du programme de fidélité : toute config commerçant hors
 * de ces bornes devient impossible (RPC + trigger DB). SESSION admin, jamais
 * service_role : admin_can() lit l'email du JWT.
 */
export async function updateLoyaltyBounds(
  _prev: LoyaltyBoundsResult,
  formData: FormData
): Promise<LoyaltyBoundsResult> {
  if (!(await adminCan("commercants"))) {
    return { error: "Accès réservé au domaine Commerçants." };
  }

  const vals = {
    p_min_earn_rate_pct: readNum(formData, "min_earn_rate_pct"),
    p_max_earn_rate_pct: readNum(formData, "max_earn_rate_pct"),
    p_min_tier_threshold_da: readNum(formData, "min_tier_threshold_da"),
    p_max_tier_reward_da: readNum(formData, "max_tier_reward_da"),
    p_max_daily_credit_cap_da: readNum(formData, "max_daily_credit_cap_da"),
    p_max_link_bonus_da: readNum(formData, "max_link_bonus_da"),
    p_min_voucher_validity_days: readNum(formData, "min_voucher_validity_days"),
    p_max_voucher_validity_days: readNum(formData, "max_voucher_validity_days"),
    p_max_purchase_per_credit_da: readNum(
      formData,
      "max_purchase_per_credit_da"
    ),
    p_max_batch_quantity: readNum(formData, "max_batch_quantity"),
  };
  if (Object.values(vals).some((v) => v === null)) {
    return { error: "Toutes les bornes sont obligatoires." };
  }

  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: { ok?: boolean; reason?: string } | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await rpc("admin_loyalty_update_settings", vals);

  if (error) return { error: "Enregistrement impossible. Réessayez." };
  if (!data?.ok) {
    return {
      error:
        data?.reason === "bad_bounds"
          ? "Bornes incohérentes (min > max, valeur nulle ou négative)."
          : "Réglage refusé.",
    };
  }

  revalidatePath("/admin/merchants/fidelite");
  return { ok: true };
}
