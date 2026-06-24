"use client";

/**
 * Garantit que le socket Realtime porte le JWT de l'utilisateur AVANT d'ouvrir
 * un canal PRIVÉ (Realtime Authorization, mig 0254).
 *
 * Un canal `config.private = true` exige que le serveur Realtime puisse vérifier
 * la RLS sur `realtime.messages` → il lui faut le token d'accès du user. En
 * théorie supabase-js le propage via `onAuthStateChange`, mais selon le timing
 * (client `@supabase/ssr` à base de cookies, abonnement juste après le montage),
 * le socket peut encore porter la clé anon → l'abonnement privé est REFUSÉ
 * (CHANNEL_ERROR) et le broadcast de dispatch n'arrive jamais. On force donc le
 * token ici (idempotent) juste avant de souscrire. Best-effort.
 */
type RealtimeAuthClient = {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token: string } | null };
    }>;
  };
  realtime: { setAuth: (token: string) => unknown };
};

export async function ensureRealtimeAuth(
  supabase: RealtimeAuthClient
): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
  } catch {
    /* best-effort : si ça échoue, le poll de secours couvre la réception */
  }
}
