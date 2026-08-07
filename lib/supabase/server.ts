import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { withLongSession } from "./session-config";
import { stripSessionWipe } from "./cookie-guard";

/**
 * Client Supabase SERVEUR — MÉMOÏSÉ PAR REQUÊTE (React `cache()`).
 *
 * ⚠️ CRITIQUE : sans mémoïsation, chaque appelant (getDriveHome, getNearbyRides,
 * getChauffeurActiveRide…) créait SON PROPRE client cookie. Quand le token
 * d'accès a expiré, plusieurs clients tentaient un refresh avec le MÊME
 * refresh-token ROTATIF à usage unique → un seul gagnait, les autres perdaient
 * l'auth (`auth.uid()` nul → RPC SECURITY DEFINER renvoyant 0 ligne EN SILENCE).
 * Bug vécu : dispatch chauffeur « 0 course » alors que le serveur la renvoyait.
 * En mémoïsant, TOUS les sous-appels d'UNE requête partagent UN client → UN seul
 * refresh, réutilisé. Analogue serveur du singleton navigateur. Sécurité
 * inchangée (le cache est par-requête, donc par-utilisateur : RLS + cookies).
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // GARDE ANTI-COURSE (cf. cookie-guard) : une Server Action qui perd
            // la course du refresh-token rotatif (ex. tick de polling parti avec
            // les anciens cookies pendant que le middleware d'une navigation
            // venait de les faire tourner) ne doit JAMAIS effacer la session.
            // La déconnexion volontaire passe par markSignedOut() qui purge
            // explicitement les cookies sb-*.
            stripSessionWipe(cookiesToSet).forEach(({ name, value, options }) =>
              cookieStore.set(name, value, withLongSession(options))
            );
          } catch {
            // setAll peut échouer dans un Server Component — OK (middleware refresh)
          }
        },
      },
    }
  );
});
