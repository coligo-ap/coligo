"use client";

/**
 * Registre des caches SWR « module » de l'espace chauffeur (accueil, gains,
 * solde, historique, demandes). Contrairement aux caches TanStack Query des
 * autres espaces — keyés par id utilisateur —, ces caches sont des variables
 * de module GLOBALES. Sans garde, un 2ᵉ chauffeur se connectant sur le MÊME
 * onglet (appareil partagé) verrait brièvement les données financières du
 * précédent avant le refetch.
 *
 * Chaque écran enregistre ici sa fonction de vidange ; `ensureChauffeurCacheForUser`
 * (appelée au render de la coque authentifiée) vide TOUT dès que l'utilisateur
 * connecté change → aucune fuite entre comptes, quel que soit le chemin de
 * déconnexion.
 */
const resetters = new Set<() => void>();

export function registerChauffeurCacheReset(fn: () => void): void {
  resetters.add(fn);
}

export function resetChauffeurClientCaches(): void {
  for (const fn of resetters) fn();
}

let cachedUserId: string | null = null;

/**
 * Vide les caches client chauffeur si le compte connecté a changé. Appelée au
 * RENDER de `ChauffeurGateProvider` (parent de toutes les pages) → la vidange est
 * SYNCHRONE et survient AVANT que les écrans enfants ne lisent les caches pour
 * initialiser leur state (pas de flash des données de l'ancien compte).
 */
export function ensureChauffeurCacheForUser(userId: string): void {
  if (cachedUserId !== null && cachedUserId !== userId) {
    resetChauffeurClientCaches();
  }
  cachedUserId = userId;
}
