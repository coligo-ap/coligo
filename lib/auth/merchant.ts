/**
 * Auth COMMERÇANT — helper de session unique, mémoïsé `cache()`.
 *
 * Avant : chaque fichier d'actions commerçant redéfinissait son propre
 * `getCurrentMerchantId` / `getCurrentMerchant` / `requireMerchant`
 * (auth.getUser + requête `merchants` dupliquées). Centralisé ici et enveloppé
 * dans React `cache()` → dédupe l'auth + la requête `merchants` dans un même
 * rendu serveur (layout + page + Server Actions). La SÉCURITÉ est intacte : le
 * cache ne survit pas entre requêtes, la session est revalidée à chaque appel,
 * RLS inchangées.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CurrentMerchant = {
  id: string;
  name: string;
  slug: string;
  is_frozen: boolean;
};

/** Le commerçant lié au user courant ; null si pas un commerçant. */
export const getCurrentMerchant = cache(
  async function getCurrentMerchant(): Promise<CurrentMerchant | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("merchants")
      .select("id, name, slug, is_frozen")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      is_frozen: data.is_frozen ?? false,
    };
  }
);

/** Raccourci : seulement l'id du commerçant courant (ou null). */
export async function getCurrentMerchantId(): Promise<string | null> {
  return (await getCurrentMerchant())?.id ?? null;
}

/**
 * Variante « garde » pour les Server Actions : renvoie le commerçant courant,
 * ou `{ error }` si la session a expiré / pas de boutique. Le call-site fait
 * `if ("error" in ctx) return ctx;`.
 */
export async function requireMerchant(): Promise<
  CurrentMerchant | { error: string }
> {
  const m = await getCurrentMerchant();
  return m ?? { error: "Session expirée, reconnectez-vous." };
}
