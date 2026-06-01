/**
 * État de pause / fermeture d'un commerce — source UNIQUE de vérité, partagée
 * entre le checkout (blocage des commandes immédiates), le bouton commerçant
 * (Ouvert / Pause / Fermé) et la boutique cliente (bandeau « fermé »).
 *
 * Trois verrous, par ordre de priorité :
 *   1. closure_start / closure_end — fermeture PROGRAMMÉE (congés). Actif tant
 *      que now() ∈ [start, end].
 *   2. paused_until — pause TEMPORAIRE à réouverture auto (Pause 30 min / 1 h /
 *      « Fermer aujourd'hui »). Une fois la date passée, le commerce rouvre seul.
 *   3. orders_paused (sans paused_until) — fermeture INDÉFINIE « jusqu'à
 *      réouverture manuelle ».
 *
 * Aucune dépendance horaire ici : la disponibilité « ouvert maintenant » selon
 * les horaires hebdo est gérée séparément (cf. opening-hours).
 */

export type MerchantPauseInput = {
  orders_paused: boolean | null;
  paused_until: string | null;
  closure_start: string | null;
  closure_end: string | null;
};

export type PauseReason =
  | "open"
  | "paused_indefinite"
  | "paused_temp"
  | "scheduled_closure";

export type PauseState = {
  /** Vrai si le commerce refuse les commandes IMMÉDIATES en ce moment. */
  closedNow: boolean;
  reason: PauseReason;
  /** Moment de réouverture connu (pause temporaire / fin de fermeture), sinon null. */
  reopensAt: Date | null;
};

export function computePauseState(
  m: MerchantPauseInput,
  now: Date = new Date()
): PauseState {
  // 1. Fermeture programmée active.
  if (m.closure_start && m.closure_end) {
    const start = new Date(m.closure_start);
    const end = new Date(m.closure_end);
    if (now >= start && now < end) {
      return { closedNow: true, reason: "scheduled_closure", reopensAt: end };
    }
  }

  // 2. Pause temporaire.
  if (m.paused_until) {
    const until = new Date(m.paused_until);
    if (until > now) {
      return { closedNow: true, reason: "paused_temp", reopensAt: until };
    }
    // Pause temporaire écoulée → réouverture automatique (on ignore
    // orders_paused : c'était une pause à durée définie).
    return { closedNow: false, reason: "open", reopensAt: null };
  }

  // 3. Fermeture indéfinie.
  if (m.orders_paused) {
    return { closedNow: true, reason: "paused_indefinite", reopensAt: null };
  }

  return { closedNow: false, reason: "open", reopensAt: null };
}

/** Message court destiné au client / au commerçant selon la raison. */
export function pauseReasonMessage(state: PauseState): string {
  switch (state.reason) {
    case "scheduled_closure":
      return "Ce commerce est en fermeture exceptionnelle.";
    case "paused_temp":
      return "Ce commerce est en pause et ne prend pas de commandes pour l'instant.";
    case "paused_indefinite":
      return "Ce commerce est momentanément fermé et ne prend pas de commandes.";
    default:
      return "";
  }
}
