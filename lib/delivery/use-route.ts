"use client";

import { useEffect, useRef, useState } from "react";
import { haversineKm } from "@/lib/delivery/distance";
import { fetchRoute, type RoutePath } from "@/lib/delivery/routing";

type LatLng = { lat: number; lng: number };

// On ne recalcule l'itinéraire que si l'origine a bougé d'au moins ~75 m OU
// qu'il s'est écoulé 20 s — pour rester poli avec le serveur OSRM public
// (1 livraison active → quelques appels/min au maximum).
const MOVE_THRESHOLD_KM = 0.075;
const MIN_INTERVAL_MS = 20_000;

/**
 * Récupère l'itinéraire routier `from → to` et le rafraîchit au fil du
 * déplacement, avec debounce. `from` ou `to` à null → désactivé.
 */
export function useRoute(
  from: LatLng | null,
  to: LatLng | null,
  enabled = true
): { path: RoutePath | null; loading: boolean } {
  const [path, setPath] = useState<RoutePath | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFrom = useRef<LatLng | null>(null);
  const lastTo = useRef<LatLng | null>(null);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!enabled || !from || !to) return;

    const toChanged =
      !lastTo.current ||
      lastTo.current.lat !== to.lat ||
      lastTo.current.lng !== to.lng;
    const moved =
      !lastFrom.current ||
      haversineKm(lastFrom.current, from) >= MOVE_THRESHOLD_KM;
    const stale = Date.now() - lastAt.current >= MIN_INTERVAL_MS;

    if (path && !toChanged && !moved && !stale) return;

    let cancelled = false;
    lastFrom.current = from;
    lastTo.current = to;
    lastAt.current = Date.now();
    setLoading(true);
    void fetchRoute(from, to).then((p) => {
      if (!cancelled) {
        setPath(p);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // On dépend des VALEURS lat/lng (pas de l'identité des objets from/to, qui
    // change à chaque render) pour ne pas refetch en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, from?.lat, from?.lng, to?.lat, to?.lng, path]);

  return { path, loading };
}
