"use client";

import { useSyncExternalStore } from "react";
import {
  watchPosition,
  getPosition,
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
let seeded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Fix one-shot IMMÉDIAT au démarrage : le `watchPosition` (haute précision,
 * sans cache) peut mettre 15-30 s à livrer son 1er relevé → la position
 * tarderait à s'afficher. On déclenche en parallèle un getPosition rapide qui
 * accepte un fix récent en cache, pour peindre le point tout de suite.
 */
function seed() {
  if (seeded) return;
  seeded = true;
  getPosition({ enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 })
    .then(accept)
    .catch(() => {
      // Repli tolérant : basse précision + cache plus large (réseau/Wi-Fi).
      getPosition({
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 120_000,
      })
        .then(accept)
        .catch(() => {
          /* géoloc refusée/indispo : le watch tentera quand même */
        });
    });
}

/**
 * Rafraîchissement FORCÉ (bouton « centrer sur ma position ») : on récupère un
 * fix frais et on l'impose au store SANS le filtre anti-jitter, pour que le
 * repère ET la caméra collent à la position réelle même après une longue
 * immobilité. Retourne le fix (ou la dernière position connue si échec).
 */
export async function refreshDriverPosition(): Promise<Coords | null> {
  try {
    const c = await getPosition({
      enableHighAccuracy: true,
      timeout: 8_000,
      maximumAge: 0,
    });
    current = c;
    emit();
    return c;
  } catch {
    return current;
  }
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
  // Fix rapide immédiat (cache toléré) EN PLUS du watch continu.
  seed();
  handle = watchPosition(accept, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 5_000,
    timeout: 15_000,
  });
}

function stop() {
  handle?.stop();
  handle = null;
  // Autorise un nouveau fix one-shot au prochain montage (utile si le seed
  // précédent avait échoué — permission accordée entre-temps, GPS revenu…).
  seeded = false;
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
