/**
 * Auth livreur — Supabase auth avec un email synthétique dérivé du téléphone
 * (le livreur ne fournit jamais d'email pour se connecter).
 *
 * Format : <chiffres-du-numéro-canonique>@drivers.coligo.local
 *   "0612345678" et "+213 612345678" → "0612345678@drivers.coligo.local"
 *   "+33603044619"                   → "33603044619@drivers.coligo.local"
 *
 * La dérivation vit dans `lib/auth/phone-identity.ts` (source unique).
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { DRIVER_DOMAIN, phoneToAuthEmail } from "@/lib/auth/phone-identity";

export { canonicalPhone } from "@/lib/auth/phone-identity";

/** `null` si le numéro est invalide — l'appelant affiche l'erreur sous le champ. */
export function phoneToEmail(rawPhone: string): string | null {
  return phoneToAuthEmail(rawPhone, DRIVER_DOMAIN);
}

/**
 * Récupère le driver lié au user courant ; null si pas un livreur.
 *
 * Mémoïsé par requête via React `cache()` : le layout (driver) ET la page
 * appellent tous deux getCurrentDriver dans le même rendu serveur → sans cache,
 * l'auth (`auth.getUser`) + la requête `drivers` partaient en double à chaque
 * navigation. `cache()` les dédupe pour le rendu courant. La SÉCURITÉ est
 * intacte : la session est toujours validée côté serveur à chaque requête
 * (le cache ne survit pas entre requêtes), RLS inchangées.
 */
export const getCurrentDriver = cache(
  async function getCurrentDriver(): Promise<{
    id: string;
    user_id: string;
    full_name: string;
    phone: string;
    is_frozen: boolean;
    is_blocked: boolean;
    is_verified: boolean;
    freeze_reason: string | null;
    block_reason: string | null;
    avatar_url: string | null;
  } | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("drivers")
      .select(
        "id, user_id, full_name, phone, is_frozen, is_blocked, is_verified, freeze_reason, block_reason, avatar_url"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    return data
      ? {
          id: data.id,
          user_id: data.user_id ?? user.id,
          full_name: data.full_name,
          phone: data.phone,
          is_frozen: data.is_frozen ?? false,
          is_blocked: data.is_blocked ?? false,
          is_verified: data.is_verified ?? false,
          freeze_reason: data.freeze_reason ?? null,
          block_reason: data.block_reason ?? null,
          avatar_url: data.avatar_url ?? null,
        }
      : null;
  }
);
