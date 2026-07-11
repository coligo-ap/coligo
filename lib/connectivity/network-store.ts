"use client";

import { useSyncExternalStore } from "react";

/**
 * État RÉSEAU confirmé — source de vérité unique alimentée par
 * `components/shared/connection-guard.tsx` (le seul composant qui SONDE le
 * réseau). Ne pas confondre avec l'intention « en ligne » du livreur/chauffeur
 * (disponibilité pour recevoir des courses, cf. `lib/driver/online-store.ts`) :
 * ici on parle de la connectivité Internet réelle.
 *
 * Usage : le garde écrit `setNetworkOffline(...)` ; tout composant qui doit se
 * désactiver hors ligne (ex. le bouton « Passer en ligne ») lit
 * `useNetworkOffline()`. On ne peut pas être « disponible » sans réseau : le
 * dispatch a besoin d'Internet.
 */
let offline = false;
const listeners = new Set<() => void>();

export function getNetworkOffline(): boolean {
  return offline;
}

export function setNetworkOffline(next: boolean): void {
  if (offline === next) return;
  offline = next;
  for (const l of listeners) l();
}

export function useNetworkOffline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => offline,
    () => false // SSR : neutre (on suppose en ligne pour éviter un flash)
  );
}
