// =============================================================================
// Sonde réseau BORNÉE — la brique anti-gel du retour d'arrière-plan.
// =============================================================================
// Au réveil (téléphone déverrouillé, retour d'onglet après de longues minutes),
// le socket HTTP gardé en vie est souvent À MOITIÉ MORT (NAT expiré, bascule
// wifi↔data) : le navigateur le réutilise et la requête part en FANTÔME — elle
// ne résout ni n'échoue. Toute requête NON ABORTABLE lancée à ce moment
// (router.refresh, Server Action de resync…) se coince, et comme le App Router
// et les Server Actions ont des files SÉRIELLES, c'est TOUTE l'app qui semble
// gelée (bug vécu : « je reviens après 20 min, plus rien ne répond »).
//
// Règle : au réveil, TOUJOURS sonder d'abord avec ce fetch abortable. Il vise
// /favicon.ico (statique, HORS middleware → pas d'auth), no-store + cache-buster
// → on teste le SOCKET, pas le cache. Un échec/timeout = connexion froide → on
// s'abstient (ou on retente), on ne lance JAMAIS l'appel qui resterait fantôme.
// =============================================================================

export async function probeConnectionAlive(timeoutMs = 3500): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`/favicon.ico?_probe=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attend que la connexion réponde VRAIMENT : sonde immédiate puis retentatives
 * espacées. Résout `true` dès qu'un aller-retour aboutit, `false` après
 * épuisement (l'appelant décide alors : s'abstenir ou tenter quand même).
 */
export async function waitForConnection(
  attempts = 3,
  delayMs = 2500
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await probeConnectionAlive()) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** Absence au-delà de laquelle on ne fait plus confiance au socket. */
export const PROBE_AFTER_HIDDEN_MS = 30_000;

/**
 * Abonnement « retour au premier plan » SÛR pour les pollers à listener brut :
 * après une absence ≥ 30 s, la sonde court AVANT le callback (anti requête
 * fantôme — voir l'en-tête). Micro-bascule = callback immédiat. Renvoie le
 * désabonnement. Les composants React préfèrent `useResumeResync` (même
 * logique, plus les évènements pageshow/focus/online).
 */
export function onVisibleResumeSafe(cb: () => void): () => void {
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (hiddenFor < PROBE_AFTER_HIDDEN_MS) {
      cb();
      return;
    }
    void (async () => {
      const ok = (await probeConnectionAlive()) || (await waitForConnection(2));
      void ok; // même à froid on tente : le socket aura été réinitialisé
      if (document.visibilityState === "visible") cb();
    })();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
