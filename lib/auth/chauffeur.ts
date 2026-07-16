/**
 * Auth CHAUFFEUR VTC — population SÉPARÉE des livreurs. Email synthétique dérivé
 * du téléphone, domaine DISTINCT pour l'isolation des rôles (middleware) :
 *   "0612345678" et "+213 612345678" → "0612345678@chauffeurs.coligo.local"
 *
 * La dérivation vit dans `lib/auth/phone-identity.ts` (source unique).
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { CHAUFFEUR_DOMAIN, phoneToAuthEmail } from "@/lib/auth/phone-identity";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";
import { getAuthUser } from "@/lib/auth/session";

export { CHAUFFEUR_DOMAIN, canonicalPhone } from "@/lib/auth/phone-identity";

/** `null` si le numéro est invalide — l'appelant affiche l'erreur sous le champ. */
export function phoneToChauffeurEmail(rawPhone: string): string | null {
  return phoneToAuthEmail(rawPhone, CHAUFFEUR_DOMAIN);
}

export type CurrentChauffeur = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  is_verified: boolean;
  is_frozen: boolean;
  is_blocked: boolean;
  vehicle_plate: string | null;
};

/**
 * Le chauffeur lié au user courant ; null si pas un chauffeur.
 *
 * PERF : `cache()` dédupe l'auth (`auth.getUser`) + la requête `chauffeurs`
 * pour un même rendu serveur (layout + page + Server Actions appellent tous
 * `getCurrentChauffeur`/`getChauffeurGate` → sans cache, double aller-retour à
 * chaque navigation). Le cache ne survit pas entre requêtes : la session est
 * toujours revalidée côté serveur, RLS inchangées (sécurité intacte).
 */
export const getCurrentChauffeur = cache(
  async function getCurrentChauffeur(): Promise<CurrentChauffeur | null> {
    const supabase = await createClient();
    // PERF+BORNE : `getAuthUser()` (cache()) partage l'unique aller-retour Auth
    // du rendu avec le reste de la chaîne — jamais un par helper (cf.
    // lib/auth/driver.ts).
    const user = await getAuthUser();
    if (!user) return null;
    const result = await withTimeoutOrNull(
      (async () =>
        supabase
          .from("chauffeurs")
          .select(
            "id, user_id, full_name, phone, is_verified, is_frozen, is_blocked, vehicle_plate"
          )
          .eq("user_id", user.id)
          .maybeSingle())(),
      4000
    );
    const data = result?.data ?? null;
    if (!data) return null;
    return {
      id: data.id,
      user_id: data.user_id ?? user.id,
      full_name: data.full_name,
      phone: data.phone,
      is_verified: data.is_verified ?? false,
      is_frozen: data.is_frozen ?? false,
      is_blocked: data.is_blocked ?? false,
      vehicle_plate: data.vehicle_plate ?? null,
    };
  }
);
