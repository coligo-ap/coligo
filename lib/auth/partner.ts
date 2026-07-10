/**
 * Auth point de recharge partenaire — Supabase auth avec email synthétique
 * dérivé du téléphone (le partenaire se connecte par téléphone + mot de passe).
 *
 * Format : <chiffres-du-tel>@partners.coligo.local
 *
 * Un partenaire est un operator_wallets(owner_type='partner') dont owner_id =
 * l'id du compte auth (cf. mig 0190). Population séparée, confinée à /partenaire
 * par le middleware (isolation des rôles).
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { PARTNER_DOMAIN, phoneToAuthEmail } from "@/lib/auth/phone-identity";

export { PARTNER_DOMAIN, canonicalPhone } from "@/lib/auth/phone-identity";

/** `null` si le numéro est invalide — l'appelant affiche l'erreur sous le champ. */
export function phoneToPartnerEmail(rawPhone: string): string | null {
  return phoneToAuthEmail(rawPhone, PARTNER_DOMAIN);
}

export type CurrentPartner = {
  walletId: string;
  ownerId: string;
  displayName: string;
  status: "active" | "suspended" | "disabled" | "pending" | "rejected";
  isVerified: boolean;
  rejectedReason: string | null;
  address: string | null;
  phone: string | null;
  balanceDa: number;
  canOperate: boolean;
};

/**
 * Récupère le point de recharge lié au user courant ; null si pas un partenaire.
 *
 * PERF : `cache()` dédupe (layout + page + actions appellent ce helper dans un
 * même rendu) et la requête `operator_wallets` + le RPC d'état partent EN
 * PARALLÈLE (le RPC ne dépend pas de la ligne wallet, seulement du user). Sur
 * la page partenaire (le cas courant) on économise un aller-retour. Sécurité
 * intacte : session revalidée à chaque requête, RLS inchangées, cache non
 * persistant entre requêtes.
 */
export const getCurrentPartner = cache(
  async function getCurrentPartner(): Promise<CurrentPartner | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    type Row = {
      id: string;
      owner_id: string;
      display_name: string | null;
      status: string;
      is_verified: boolean | null;
      rejected_reason: string | null;
      address: string | null;
      phone: string | null;
    };
    const [{ data }, { data: st }] = await Promise.all([
      (
        supabase.from as unknown as (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string
            ) => {
              eq: (
                c: string,
                v: string
              ) => { maybeSingle: () => Promise<{ data: Row | null }> };
            };
          };
        }
      )("operator_wallets")
        .select(
          "id, owner_id, display_name, status, is_verified, rejected_reason, address, phone"
        )
        .eq("owner_type", "partner")
        .eq("owner_id", user.id)
        .maybeSingle(),
      supabase.rpc("my_operator_wallet_state"),
    ]);
    if (!data) return null;

    const state = Array.isArray(st) ? st[0] : null;

    return {
      walletId: data.id,
      ownerId: data.owner_id,
      displayName: data.display_name ?? "Agent Coligo Pay",
      status: data.status as CurrentPartner["status"],
      isVerified: !!data.is_verified,
      rejectedReason: data.rejected_reason ?? null,
      address: data.address ?? null,
      phone: data.phone ?? null,
      balanceDa: state?.balance_da ?? 0,
      canOperate: state?.can_operate ?? false,
    };
  }
);
