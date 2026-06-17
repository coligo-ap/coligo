"use client";

import { useSyncExternalStore } from "react";
import {
  watchPosition,
  type Coords,
  type WatchHandle,
} from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";

/**
 * Position GPS STABLE du livreur, MUTUALISÉE (store module). Un SEUL
 * `watchPosition` tourne pour toute l'app livreur, quel que soit le nombre de
 * composants qui l'observent (carte, dispatch, course…) → économie de batterie
 * et position conservée entre onglets (elle ne se « recharge » pas à chaque
 * navigation). Le watch démarre au 1er abonné et s'arrête au dernier.
 *
 * Le flux brut est assaini (le GPS « saute » sinon) :
 *  1. Filtre de précision (au-delà de ACCURACY_GATE, sauf le tout premier fix).
 *  2. Anti-régression : un relevé nettement moins précis (encore frais) ignoré.
 *  3. Anti-jitter : un micro-déplacement sous le bruit GPS ne bouge pas le point.
 */

const ACCURACY_GATE = 75; // m — au-delà, relevé jugé trop imprécis.
const STALE_MS = 15_000; // un fix devient « périmé » après 15 s.

let current: Coords | null = null;
let handle: WatchHandle | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Applique le filtrage et notifie les abonnés si le point retenu change. */
function accept(next: Coords) {
  const cur = current;
  // Premier fix : on l'accepte pour afficher le point sans attendre.
  if (!cur) {
    current = next;
    emit();
    return;
  }
  const fresh = next.timestamp - cur.timestamp < STALE_MS;
  if (next.accuracy > ACCURACY_GATE && fresh) return;
  if (next.accuracy > cur.accuracy * 2 && fresh) return;

  const movedM =
    haversineKm(
      { lat: cur.latitude, lng: cur.longitude },
      { lat: next.latitude, lng: next.longitude }
    ) * 1000;
  const jitterThreshold = Math.max(4, next.accuracy * 0.5);
  if (movedM < jitterThreshold && next.accuracy >= cur.accuracy) return;

  current = next;
  emit();
}

function start() {
  if (handle) return;
  handle = watchPosition(accept, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15_000,
  });
}

function stop() {
  handle?.stop();
  handle = null;
}

export function useDriverPosition(): Coords | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (listeners.size === 1) start(); // 1er abonné → démarre le watch unique
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) stop(); // plus d'abonné → on arrête
      };
    },
    () => current,
    () => null
  );
}
