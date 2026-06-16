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

import { createClient } from "@/lib/supabase/server";

export const PARTNER_DOMAIN = "partners.coligo.local";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) throw new Error("phone_empty");
  return digits;
}

export function phoneToPartnerEmail(rawPhone: string): string {
  return `${normalizePhone(rawPhone)}@${PARTNER_DOMAIN}`;
}

export type CurrentPartner = {
  walletId: string;
  ownerId: string;
  displayName: string;
  status: "active" | "suspended" | "disabled";
  address: string | null;
  phone: string | null;
  balanceDa: number;
  canOperate: boolean;
};

/** Récupère le point de recharge lié au user courant ; null si pas un partenaire. */
export async function getCurrentPartner(): Promise<CurrentPartner | null> {
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
    address: string | null;
    phone: string | null;
  };
  const { data } = await (
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
    .select("id, owner_id, display_name, status, address, phone")
    .eq("owner_type", "partner")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return null;

  const { data: st } = await supabase.rpc("my_operator_wallet_state");
  const state = Array.isArray(st) ? st[0] : null;

  return {
    walletId: data.id,
    ownerId: data.owner_id,
    displayName: data.display_name ?? "Agent Coligo Pay",
    status: data.status as CurrentPartner["status"],
    address: data.address ?? null,
    phone: data.phone ?? null,
    balanceDa: state?.balance_da ?? 0,
    canOperate: state?.can_operate ?? false,
  };
}
