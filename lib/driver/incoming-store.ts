"use client";

import { useSyncExternalStore } from "react";

/**
 * Signal « nouvelle course reçue » — pont ULTRA RAPIDE entre le dispatch
 * (ZoneDispatch, qui attribue la course via le pull) et l'affichage
 * (IncomingRequests, la liste dépliable de l'accueil).
 *
 * Dès que le pull renvoie un orderId, ZoneDispatch appelle `bumpIncoming()` :
 * l'accordéon recharge IMMÉDIATEMENT sa liste, sans attendre le Realtime
 * Postgres ni le polling de repli. C'est ce qui rend la réception « instantanée »
 * pour le livreur (l'attribution serveur et l'affichage sont dans le même tick).
 */
let nonce = 0;
const listeners = new Set<() => void>();

export function bumpIncoming(): void {
  nonce++;
  for (const l of listeners) l();
}

export function useIncomingSignal(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => nonce,
    () => 0
  );
}
