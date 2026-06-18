/**
 * Auth CLIENT — helpers de session uniques, mémoïsés `cache()`.
 *
 * Avant : plusieurs fichiers (pages + actions + la coque CustomerShell)
 * refaisaient chacun `auth.getUser` + une requête `customers` → 2 allers-retours
 * d'auth par page (coque + page). Centralisé + `cache()` ici (et `getAuthUser`
 * partagé) → un seul `auth.getUser` et une seule requête `customers` par rendu.
 * Sécurité intacte : cache non persistant entre requêtes, session revalidée,
 * RLS inchangées.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";

export type CurrentCustomer = { id: string };

/** Le client lié au user courant ; null si pas un client / non connecté. */
export const getCurrentCustomer = cache(
  async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
    const user = await getAuthUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    return data ? { id: data.id } : null;
  }
);

/**
 * Profil client complet (superset des colonnes utilisées par les pages et la
 * coque). Mémoïsé : la coque + la page + leurs composants partagent la MÊME
 * requête `customers` dans un rendu. Colonnes en snake_case (mêmes accès qu'au
 * niveau des call-sites historiques).
 */
export const getCurrentCustomerFull = cache(
  async function getCurrentCustomerFull() {
    const user = await getAuthUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("customers")
      .select(
        "id, full_name, phone, email, latitude, longitude, default_wilaya_code, default_commune"
      )
      .eq("user_id", user.id)
      .maybeSingle();
    return data ?? null;
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
