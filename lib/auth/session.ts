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

export const getAuthUser = cache(
  async function getAuthUser(): Promise<User | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  }
);
