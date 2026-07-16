/**
 * Session Supabase mémoïsée par requête.
 *
 * `auth.getUser()` valide le JWT (souvent un aller-retour réseau vers l'Auth
 * Supabase) : appelé en double (coque + page + helpers de session) à chaque
 * navigation, il pesait lourd. `getAuthUser()` enveloppe l'appel dans React
 * `cache()` → UN SEUL `auth.getUser` par rendu serveur, partagé par tous les
 * helpers (`getCurrentCustomer`, `getCurrentMerchant`, …) et la coque client.
 * Sécurité intacte : le cache ne survit pas entre requêtes (la session est
 * revalidée à chaque requête), RLS inchangées.
 */

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { withTimeoutOrNull } from "@/lib/async/with-timeout";

export const getAuthUser = cache(
  async function getAuthUser(): Promise<User | null> {
    const supabase = await createClient();
    // BORNE OBLIGATOIRE (même esprit que lib/supabase/middleware.ts, où
    // `getUser()` est déjà bornée à 4 s) : cette fonction est le SOCLE partagé
    // de getCurrentCustomer/getCurrentMerchant/… et tourne dans CHAQUE
    // layout/page RSC. Un socket à moitié mort au réveil d'arrière-plan (app
    // restée longtemps en fond) ne doit jamais laisser cet `await` pendre —
    // sinon toute navigation de l'espace concerné se fige (« page qui
    // n'avance plus »). Timeout → traité comme non connecté (jamais un blocage
    // muet), exactement comme un échec réseau.
    const result = await withTimeoutOrNull(supabase.auth.getUser(), 4000);
    return result?.data.user ?? null;
  }
);
