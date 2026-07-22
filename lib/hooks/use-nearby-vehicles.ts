"use client";

import { useEffect, useRef, useState } from "react";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import type { NearbyVehicle } from "@/app/(customer)/drive/actions";

// =============================================================================
// Véhicules disponibles autour du client (écran des gammes / de recherche).
//
// Trois précautions, apprises des écrans « live » du projet :
//   - ROUTE JSON, PAS SERVER ACTION : Next re-rend l'arbre serveur après
//     chaque action — en polling, cela relançait le rendu de l'écran Drive en
//     boucle (« Maximum update depth exceeded ») ;
//   - RELEVÉ BORNÉ : un seul appel en vol à la fois, et on ne repart pas si le
//     précédent n'est pas revenu (réseau lent = pas d'empilement de requêtes) ;
//   - ONGLET CACHÉ = AUCUN appel : en arrière-plan les timers sont bridés et le
//     résultat ne sert à personne ; on RE-SYNCHRONISE au retour au premier plan
//     (`useResumeResync`), sinon la carte affiche des voitures fantômes ;
//   - CAP DÉDUIT : quand le GPS du chauffeur ne fournit pas de cap (à l'arrêt,
//     appareils sans boussole), on le calcule à partir du DÉPLACEMENT entre
//     deux relevés, et on conserve le dernier cap connu tant que le véhicule
//     n'a pas bougé de façon significative — sinon le véhicule pivoterait au
//     nord à chaque feu rouge.
// =============================================================================

/** Distance minimale (m) pour recalculer un cap depuis le déplacement. */
const MIN_MOVE_M = 12;

export type MapVehicle = NearbyVehicle & {
  /** Cap RÉSOLU (GPS, sinon déduit du déplacement, sinon dernier connu). */
  bearing: number;
};

function bearingBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function useNearbyVehicles({
  pickup,
  gamme = null,
  enabled = true,
  intervalMs = 7000,
}: {
  pickup: { lat: number; lng: number } | null | undefined;
  /** Filtre de gamme (null = toutes) — l'écran des gammes s'en sert. */
  gamme?: string | null;
  enabled?: boolean;
  intervalMs?: number;
}): MapVehicle[] {
  const [vehicles, setVehicles] = useState<MapVehicle[]>([]);
  // Dernière position + cap connus PAR VÉHICULE (mémoire entre deux relevés).
  const last = useRef<
    Map<string, { lat: number; lng: number; bearing: number }>
  >(new Map());
  const inFlight = useRef(false);
  // Retour au premier plan ⇒ relance immédiate (le hook partagé n'expose pas
  // de valeur : on bump un compteur qui entre dans les deps de l'effet).
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  const lat = pickup?.lat ?? null;
  const lng = pickup?.lng ?? null;

  useEffect(() => {
    if (!enabled || lat == null || lng == null) {
      setVehicles([]);
      return;
    }
    let alive = true;

    const tick = async () => {
      if (!alive || inFlight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlight.current = true;
      try {
        const res = await fetch(
          `/api/drive/nearby-vehicles?lat=${lat}&lng=${lng}` +
            (gamme ? `&gamme=${encodeURIComponent(gamme)}` : ""),
          { cache: "no-store" }
        );
        const rows: NearbyVehicle[] = res.ok
          ? ((await res.json()).vehicles ?? [])
          : [];
        if (!alive) return;
        const seen = new Set<string>();
        const next = rows.map((v) => {
          seen.add(v.token);
          const prev = last.current.get(v.token);
          let bearing: number;
          if (v.heading != null) {
            bearing = v.heading;
          } else if (prev && distanceM(prev, v) >= MIN_MOVE_M) {
            bearing = bearingBetween(prev, v);
          } else if (prev) {
            bearing = prev.bearing;
          } else {
            // Premier relevé sans cap : orientation STABLE dérivée du jeton
            // (plutôt qu'un nord uniforme qui ferait une grille de voitures
            // toutes alignées, ou un aléatoire qui sauterait à chaque rendu).
            bearing =
              (v.token.charCodeAt(0) * 7 + v.token.charCodeAt(1) * 13) % 360;
          }
          last.current.set(v.token, { lat: v.lat, lng: v.lng, bearing });
          return { ...v, bearing };
        });
        // Purge des véhicules disparus (évite une mémoire qui enfle).
        for (const key of [...last.current.keys()]) {
          if (!seen.has(key)) last.current.delete(key);
        }
        setVehicles(next);
      } catch {
        /* silencieux : la carte reste utilisable sans les véhicules */
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // `resyncNonce` : relance immédiate au retour au premier plan.
  }, [enabled, lat, lng, gamme, intervalMs, resyncNonce]);

  return vehicles;
}
