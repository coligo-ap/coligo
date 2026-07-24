"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyReferralRewarded } from "@/lib/fcm/triggers";

// =============================================================================
// Actions Marketing → Parrainage. Double garde : adminCan('marketing') ici
// (UX propre) + admin_can('marketing') DANS chaque RPC (sécurité réelle).
// Les RPC s'appellent avec la SESSION admin — jamais service_role (le JWT
// service n'a pas d'email, la garde RBAC refuserait).
// =============================================================================

type ActionResult = { ok: true } | { ok: false; error: string };

async function sessionRpc(): Promise<
  (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>
> {
  const supabase = await createClient();
  // RPC hors types générés → bind OBLIGATOIRE (reference_supabase_rpc_bind).
  return supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function updateReferralSettings(input: {
  enabled: boolean;
  reward_referrer_da: number;
  reward_referee_da: number;
  min_order_da: number;
  max_referrals_month: number;
  attribution_expiry_days: number;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };

  const rpc = await sessionRpc();
  const { data, error } = await rpc("admin_update_referral_settings", {
    p_enabled: input.enabled,
    p_reward_referrer_da: Math.round(input.reward_referrer_da),
    p_reward_referee_da: Math.round(input.reward_referee_da),
    p_min_order_da: Math.round(input.min_order_da),
    p_max_referrals_month: Math.round(input.max_referrals_month),
    p_attribution_expiry_days: Math.round(input.attribution_expiry_days),
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; reason?: string } | null;
  if (!res?.ok) {
    return { ok: false, error: "Valeurs invalides — vérifie les champs." };
  }

  revalidatePath("/admin/marketing/parrainage");
  return { ok: true };
}

/**
 * Tranche un parrainage RETENU (`held`) : approve → `rewarded` (le trigger SQL
 * T2 crédite les deux wallets dans la même transaction) ; reject → `rejected`.
 * L'approbation pousse aussi les notifications aux deux clients.
 */
export async function decideReferral(input: {
  id: string;
  action: "approve" | "reject";
  note?: string;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };

  const rpc = await sessionRpc();
  const { data, error } = await rpc("admin_referral_decide", {
    p_id: input.id,
    p_action: input.action,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; reason?: string } | null;
  if (!res?.ok) {
    return {
      ok: false,
      error:
        res?.reason === "not_held"
          ? "Ce parrainage n'est plus en attente de revue."
          : "Parrainage introuvable.",
    };
  }

  if (input.action === "approve") {
    // Push aux deux clients — lecture service (hors types → cast local).
    try {
      const admin = createAdminClient();
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{
              data: {
                referrer_customer_id: string;
                referee_customer_id: string;
                reward_referrer_da: number;
                reward_referee_da: number;
              } | null;
            }>;
          };
        };
      };
      const { data: row } = await from("customer_referrals")
        .select(
          "referrer_customer_id, referee_customer_id, reward_referrer_da, reward_referee_da"
        )
        .eq("id", input.id)
        .maybeSingle();
      if (row) {
        void notifyReferralRewarded({
          referrerCustomerId: row.referrer_customer_id,
          refereeCustomerId: row.referee_customer_id,
          referrerAmountDa: row.reward_referrer_da,
          refereeAmountDa: row.reward_referee_da,
        });
      }
    } catch (e) {
      console.warn("[admin referral] push après approbation:", e);
    }
  }

  revalidatePath("/admin/marketing/parrainage");
  return { ok: true };
}

/** Révoque un parrainage déjà crédité (contre-passation, RPC mig 0403). */
export async function revokeReferral(input: {
  id: string;
  note?: string;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };

  const rpc = await sessionRpc();
  const { data, error } = await rpc("admin_revoke_referral", {
    p_id: input.id,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; reason?: string } | null;
  if (!res?.ok) {
    const reasons: Record<string, string> = {
      not_found: "Parrainage introuvable.",
      not_rewarded: "Seul un parrainage récompensé peut être révoqué.",
      referrer_spent:
        "Solde du parrain insuffisant — récompense déjà dépensée.",
      referee_spent: "Solde du filleul insuffisant — récompense déjà dépensée.",
    };
    return {
      ok: false,
      error: reasons[res?.reason ?? ""] ?? "Révocation impossible.",
    };
  }

  revalidatePath("/admin/marketing/parrainage");
  return { ok: true };
}

/** Recherche serveur (nom, téléphone, code) — même RPC que la page. */
export async function searchReferrals(input: {
  status?: string | null;
  q?: string | null;
}): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };

  const rpc = await sessionRpc();
  const { data, error } = await rpc("admin_referral_list", {
    p_status: input.status ?? null,
    p_q: input.q ?? null,
    p_limit: 200,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data as unknown[]) ?? [] };
}
