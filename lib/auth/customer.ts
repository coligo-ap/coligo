/**
 * Auth CLIENT — helper de session unique, mémoïsé `cache()`.
 *
 * Avant : plusieurs fichiers d'actions client redéfinissaient leur propre
 * `requireCustomer` (auth.getUser + requête `customers`). Centralisé ici et
 * enveloppé dans React `cache()` → dédup auth + requête `customers` dans un
 * même rendu serveur. Sécurité intacte : cache non persistant entre requêtes,
 * session revalidée à chaque appel, RLS inchangées.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CurrentCustomer = { id: string };

/** Le client lié au user courant ; null si pas un client / non connecté. */
export const getCurrentCustomer = cache(
  async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    return data ? { id: data.id } : null;
  }
);

/**
 * Variante « garde » pour les Server Actions : renvoie `{ id }` ou `{ error }`.
 * Call-site : `if ("error" in c) return c;`.
 */
export async function requireCustomer(): Promise<
  CurrentCustomer | { error: string }
> {
  const c = await getCurrentCustomer();
  return c ?? { error: "Session expirée, reconnectez-vous." };
}
