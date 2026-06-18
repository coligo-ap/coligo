import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Client Supabase NAVIGATEUR — SINGLETON (une seule instance par onglet).
 *
 * ⚠️ PERF/ROBUSTESSE : `createBrowserClient` installe à chaque appel sa propre
 * machinerie (GoTrueClient : timer d'auto-refresh du token, listeners
 * onAuthStateChange + visibilitychange + storage) ET sa propre connexion
 * Realtime (WebSocket). Sans singleton, CHAQUE composant client qui appelle
 * `createClient()` (souvent dans un effet realtime/poll) créait un client +
 * socket de plus → accumulation à chaque navigation tant qu'on est « en ligne »
 * (chauffeur/livreur à l'écoute), jusqu'à saturer le thread (affichage 5–10 s).
 *
 * Le singleton règle ça à la racine : UN client, UN socket, UNE machinerie auth
 * partagés pour tout l'onglet. Les `channel(name)` restent indépendants et sont
 * nettoyés par `removeChannel` à chaque démontage. Sécurité inchangée : le
 * client anon n'agit que dans les limites des RLS, l'auth vient des cookies.
 *
 * C'est aussi le pattern recommandé par Supabase pour le client navigateur.
 */
type Client = ReturnType<typeof createBrowserClient<Database>>;

let browserClient: Client | undefined;

export function createClient(): Client {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return browserClient;
}
