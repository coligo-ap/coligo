"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LoyaltyFormResult = { error?: string; ok?: boolean };

// Codes renvoyés par merchant_update_loyalty_program (mig 0454) → messages
// utilisateur, avec les bornes injectées quand la RPC les fournit.
function boundsError(
  code: string,
  extra: { min?: number | string; max?: number | string }
): string {
  const min = extra.min !== undefined ? String(extra.min) : null;
  const max = extra.max !== undefined ? String(extra.max) : null;
  switch (code) {
    case "bounds_earn_rate":
      return `Taux de cashback autorisé : entre ${min ?? "0"} % et ${max ?? "?"} %.`;
    case "bounds_tier_pair":
      return "Renseignez le seuil ET la récompense du palier (ou désactivez le palier).";
    case "bounds_tier_threshold":
      return `Le seuil du palier doit être d'au moins ${min ?? "?"} DA.`;
    case "bounds_tier_reward":
      return `La récompense du palier ne peut pas dépasser ${max ?? "?"} DA.`;
    case "bounds_validity":
      return `Validité des bons autorisée : entre ${min ?? "?"} et ${max ?? "?"} jours.`;
    case "bounds_daily_cap":
      return `Le plafond quotidien ne peut pas dépasser ${max ?? "?"} DA.`;
    case "bounds_link_bonus":
      return `Le bonus de liaison ne peut pas dépasser ${max ?? "?"} DA.`;
    case "not_merchant":
      return "Session expirée — reconnectez-vous.";
    default:
      return "Réglage refusé. Vérifiez les valeurs saisies.";
  }
}

function readInt(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function updateLoyaltyProgram(
  _prev: LoyaltyFormResult,
  formData: FormData
): Promise<LoyaltyFormResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée — reconnectez-vous." };

  const enabled = formData.get("enabled") === "1";
  const tierOn = formData.get("tier_on") === "1";

  const rawRate = String(formData.get("earn_rate_pct") ?? "").trim();
  const earnRate = rawRate === "" ? null : Number(rawRate.replace(",", "."));
  if (earnRate === null || !Number.isFinite(earnRate) || earnRate < 0) {
    return { error: "Taux de cashback invalide." };
  }

  const tierThreshold = tierOn ? readInt(formData, "tier_threshold_da") : null;
  const tierReward = tierOn ? readInt(formData, "tier_reward_da") : null;
  if (tierOn && (tierThreshold === null || tierReward === null)) {
    return { error: "Renseignez le seuil ET la récompense du palier." };
  }

  const validity = readInt(formData, "voucher_validity_days");
  const dailyCap = readInt(formData, "daily_credit_cap_da");
  const linkBonus = readInt(formData, "link_bonus_da") ?? 0;
  if (validity === null || dailyCap === null) {
    return { error: "Validité et plafond quotidien sont obligatoires." };
  }

  // RPC hors types générés → bind obligatoire (cf. lib/customer/cashback.ts).
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: {
      ok?: boolean;
      error?: string;
      min?: number | string;
      max?: number | string;
    } | null;
    error: { message: string } | null;
  }>;

  const { data, error } = await rpc("merchant_update_loyalty_program", {
    p_enabled: enabled,
    p_earn_rate_pct: earnRate,
    p_tier_threshold_da: tierThreshold,
    p_tier_reward_da: tierReward,
    p_voucher_validity_days: validity,
    p_daily_credit_cap_da: dailyCap,
    p_link_bonus_da: linkBonus,
  });

  if (error) return { error: "Enregistrement impossible. Réessayez." };
  if (!data?.ok) {
    return { error: boundsError(data?.error ?? "", data ?? {}) };
  }

  revalidatePath("/fidelite");
  return { ok: true };
}
