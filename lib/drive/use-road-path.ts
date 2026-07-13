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
 *
 * `retryMs` (points FIXES, ex. écrans prix/recherche) : si la réponse arrive
 * SANS géométrie (OSRM en disjoncteur ~60 s), on retente jusqu'à 2 fois après
 * ce délai — le tracé réel remplace alors la ligne droite en silence. Sans
 * cette option (points mobiles), le prochain déplacement re-tente déjà.
 */
export function useRoadPath(
  from: LatLng | null,
  to: LatLng | null,
  opts?: { retryMs?: number }
): LatLng[] | null {
  const retryMs = opts?.retryMs;
  const [path, setPath] = useState<LatLng[] | null>(null);
  // Nonce bumpé par le timer de retry → relance l'effet sur la MÊME paire.
  const [retryNonce, setRetryNonce] = useState(0);
  const lastRef = useRef<{ from: LatLng; to: LatLng } | null>(null);
  const pairKeyRef = useRef("");
  const attemptsRef = useRef(0);
  useEffect(() => {
    if (!from || !to) {
      lastRef.current = null;
      pairKeyRef.current = "";
      attemptsRef.current = 0;
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
    // Nouvelle paire (vraie navigation, pas un retry) → compteur remis à zéro.
    const key = [from.lat, from.lng, to.lat, to.lng]
      .map((v) => v.toFixed(4))
      .join(",");
    if (key !== pairKeyRef.current) {
      pairKeyRef.current = key;
      attemptsRef.current = 0;
    }
    lastRef.current = { from, to };
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = () => {
      if (!retryMs || attemptsRef.current >= 2) return;
      attemptsRef.current += 1;
      timer = setTimeout(() => {
        lastRef.current = null; // invalide la mémo → l'effet re-demande
        setRetryNonce((n) => n + 1);
      }, retryMs);
    };
    void routeEstimate({ from, to })
      .then((r) => {
        if (cancelled) return;
        if (r.ok && r.geometry) setPath(r.geometry);
        else scheduleRetry();
      })
      .catch(() => {
        if (!cancelled) scheduleRetry();
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng, retryNonce]);
  return path;
}
