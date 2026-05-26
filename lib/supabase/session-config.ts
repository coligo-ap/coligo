/**
 * Durée de vie des cookies de session Supabase.
 *
 * Politique demandée :
 *  - Commerçant (PWA / APK / web) : illimité jusqu'à déconnexion → 380 jours
 *    (Chrome refuse les cookies > 400 jours, on prend une marge).
 *  - Client PWA / APK : illimité jusqu'à déconnexion → 380 jours.
 *  - Client web : ~3 mois → mais comme on ne peut pas distinguer côté serveur
 *    PWA vs web pour un client AVANT qu'il se connecte, on applique 380j
 *    partout. C'est sans risque : si le client efface ses cookies ou change
 *    de mdp, la session est révoquée côté Supabase ; si le refresh token
 *    Supabase est invalidé (via console), la session expire ; si le browser
 *    perd le cookie (navigation privée fermée), idem.
 *  - Livreur : pareil — 380 jours pour ne jamais le déconnecter en pleine
 *    livraison.
 *
 * En résumé : on délègue la "vraie" gestion de session à Supabase Auth
 * (refresh token TTL, révocation côté serveur). Le max-age cookie est juste
 * le plafond client-side de quand on N'INTERROGE même pas Supabase.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 380;

import type { CookieOptions } from "@supabase/ssr";

/**
 * Étend les options cookie fournies par @supabase/ssr avec une longue
 * `maxAge` SAUF pour les cookies marqués comme expirant (Max-Age=0) lors
 * d'un logout — auquel cas on respecte le delete.
 */
export function withLongSession(
  options: CookieOptions | undefined
): CookieOptions {
  const base: CookieOptions = { ...options };
  // Si le caller veut explicitement supprimer le cookie, ne pas écraser.
  if (base.maxAge === 0 || base.expires) return base;
  return {
    ...base,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    sameSite: base.sameSite ?? "lax",
    httpOnly: base.httpOnly ?? true,
    secure:
      base.secure ?? (process.env.NODE_ENV === "production" ? true : undefined),
  };
}
