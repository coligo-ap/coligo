import type { CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/** Cookie Supabase (`sb-<ref>-auth-token`, chunks `.0/.1`, code-verifier…). */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-");
}

/**
 * GARDE ANTI-COURSE du refresh-token ROTATIF.
 *
 * Quand un refresh échoue (requête PERDANTE d'une course : elle portait encore
 * l'ancien refresh-token pendant qu'une requête parallèle venait de le faire
 * tourner), supabase-js « supprime la session » : il émet un batch `setAll`
 * composé UNIQUEMENT de suppressions (value vide) des cookies sb-*. Propager ce
 * batch au navigateur détruirait les cookies FRAIS posés par la requête
 * gagnante → session tuée pour un simple aléa de timing (bug vécu : balayage
 * client, ~8 rechargements rapprochés ⇒ déconnexion totale).
 *
 * Règle : le middleware et les Server Actions ne SUPPRIMENT JAMAIS les cookies
 * d'auth d'eux-mêmes — leur seul travail cookie est le RAFRAÎCHISSEMENT. La
 * déconnexion VOLONTAIRE efface, elle, explicitement via `markSignedOut()`
 * (qui purge les cookies sb-* en plus de poser son marqueur).
 *
 * Un batch MIXTE (au moins une value non vide) est une (ré)écriture légitime :
 * ses suppressions — nettoyage d'un chunk `.1` devenu inutile, purge du
 * code-verifier après échange OAuth — sont CONSERVÉES telles quelles, sinon un
 * chunk périmé resterait et corromprait la session.
 */
export function stripSessionWipe(cookies: CookieToSet[]): CookieToSet[] {
  const auth = cookies.filter((c) => isSupabaseAuthCookie(c.name));
  const isPureWipe = auth.length > 0 && auth.every((c) => !c.value);
  if (!isPureWipe) return cookies;
  return cookies.filter((c) => !isSupabaseAuthCookie(c.name));
}
