"use client";

import { useSyncExternalStore } from "react";

/**
 * Visibilité de la page/app (`document.visibilityState`), partagée et réactive.
 *
 * Sert l'HYGIÈNE des connexions Realtime : sur le plan Supabase Free, le quota
 * de connexions WebSocket concurrentes est PARTAGÉ par TOUS les rôles
 * (chauffeur + livreur + commerçant + client). Une app en arrière-plan qui garde
 * son abonnement ouvert « gaspille » une connexion du pool commun. En gâtant les
 * abonnements persistants sur cette valeur, on FERME le canal quand l'app passe
 * en arrière-plan (le FCM + un poll de secours couvrent ce cas) et on le ROUVRE
 * au retour au premier plan → on rend la connexion au pool quand on ne s'en sert
 * pas.
 *
 * On n'écoute QUE `visibilitychange` (app/onglet réellement masqué), pas
 * focus/blur : sur desktop, cliquer une autre fenêtre laisse l'onglet
 * « visible » et ne doit pas churner les abonnements.
 */
function subscribe(cb: () => void): () => void {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function getSnapshot(): boolean {
  return document.visibilityState === "visible";
}

export function usePageVisible(): boolean {
  // Snapshot serveur (SSR) = true : on ne bloque jamais le 1ᵉʳ rendu.
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
