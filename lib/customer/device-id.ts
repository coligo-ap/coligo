"use client";

// =============================================================================
// Identifiant d'APPAREIL (anti-fraude promos, façon Uber Eats) — UUID généré à
// la première ouverture et persisté localement (localStorage : survit aux
// mises à jour de l'app ET aux changements de compte — le cas de fraude
// principal : supprimer son compte / multi-comptes pour re-farmer un code).
// Limites assumées : une désinstallation complète le régénère et un client
// web peut l'effacer — c'est un DÉTERRENT de première ligne, complété côté
// serveur par la mémoire (promotion, appareil) + le journal IP/UA existant
// (/admin/devices). Jamais utilisé pour autre chose que l'anti-abus.
// =============================================================================

const KEY = "coligo:device-id";

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Stockage indisponible (navigation privée stricte) : pas d'identifiant —
    // le serveur garde ses autres gardes (per_customer_limit, IP/UA).
    return null;
  }
}
