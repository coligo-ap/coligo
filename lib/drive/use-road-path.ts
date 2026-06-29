"use client";

import { useEffect, useRef, useState } from "react";
import { haversineKm } from "@/lib/delivery/distance";
import { routeEstimate } from "@/app/(customer)/actions";
import type { LatLng } from "@/components/customer/drive/drive-map";

/**
 * Tracé ROUTIER réel (OSRM) entre deux points, partagé client + chauffeur pour
 * dessiner le trajet A → B sur la carte. Renvoie la géométrie (liste de points)
 * ou `null` tant qu'elle n'est pas disponible (l'appelant retombe alors sur une
 * ligne droite). Mémoïse la dernière paire (évite de re-router pour un
 * micro-déplacement du véhicule) et borne les appels via `routeEstimate`
 * (disjoncteur OSRM côté serveur).
 */
export function useRoadPath(
  from: LatLng | null,
  to: LatLng | null
): LatLng[] | null {
  const [path, setPath] = useState<LatLng[] | null>(null);
  const lastRef = useRef<{ from: LatLng; to: LatLng } | null>(null);
  useEffect(() => {
    if (!from || !to) {
      lastRef.current = null;
      setPath(null);
      return;
    }
    const last = lastRef.current;
    if (
      last &&
      haversineKm(last.from, from) < 0.15 &&
      haversineKm(last.to, to) < 0.05
    )
      return;
    lastRef.current = { from, to };
    let cancelled = false;
    void routeEstimate({ from, to })
      .then((r) => {
        if (!cancelled && r.ok && r.geometry) setPath(r.geometry);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng]);
  return path;
}
