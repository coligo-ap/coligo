"use client";

/**
 * Registre « l'écran de dispatch in-app est ACTIF » par rôle.
 *
 * Sert à DÉDUPLIQUER le foreground : une course arrive par DEUX canaux —
 * broadcast Realtime (popup in-app riche) ET push FCM (notif système). Sur natif
 * Android, le push reçu au premier plan est silencieux → pas de doublon. Mais
 * sur WEB/PWA, `onMessage` (push-web) afficherait une notif système EN PLUS du
 * popup. Quand l'écran de dispatch in-app est monté et écoute (broadcast actif),
 * il gère déjà la course → on supprime la notif système redondante.
 *
 * Inversement, si le partenaire est sur une AUTRE page (pas d'écoute broadcast),
 * le registre est à 0 → la notif système FCM est conservée (sinon il ne verrait
 * rien). Compteur (et non booléen) : robuste si deux écrans s'enregistrent.
 */
type DispatchRole = "chauffeur" | "courier";

const active: Record<DispatchRole, number> = { chauffeur: 0, courier: 0 };

/** À appeler au montage (on=true) / démontage (on=false) de l'écoute dispatch. */
export function setDispatchActive(role: DispatchRole, on: boolean): void {
  active[role] = Math.max(0, active[role] + (on ? 1 : -1));
}

/** Vrai si un écran de dispatch in-app écoute actuellement pour ce rôle. */
export function isDispatchActive(role: DispatchRole): boolean {
  return active[role] > 0;
}
