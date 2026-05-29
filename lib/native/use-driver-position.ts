"use client";

import { useEffect, useRef, useState } from "react";
import { watchPosition, type Coords } from "@/lib/native/geolocation";
import { haversineKm } from "@/lib/delivery/distance";

/**
 * Position GPS STABLE du livreur pour l'affichage carte.
 *
 * Le `watchPosition` brut fait « sauter » le point : le GPS renvoie des relevés
 * de précision très variable (parfois plusieurs centaines de mètres) et le
 * moindre bruit déplace le marqueur. Ici on assainit le flux pour que le point
 * affiché corresponde à la position réelle du livreur, et qu'il ne bouge pas
 * « n'importe comment » :
 *
 *  1. **Filtre de précision** : on ignore les relevés au-delà de `ACCURACY_GATE`
 *     (sauf le tout premier, pour afficher quelque chose tout de suite). Un
 *     mauvais fix GPS ne fait donc pas téléporter le point.
 *  2. **Anti-régression** : un relevé nettement MOINS précis que l'actuel est
 *     rejeté tant que l'actuel reste frais.
 *  3. **Anti-jitter** : un micro-déplacement (sous le seuil lié à la précision)
 *     sans gain de précision ne met pas à jour le point → il reste immobile
 *     quand le livreur ne bouge pas.
 */

const ACCURACY_GATE = 75; // m — au-delà, relevé jugé trop imprécis.
const STALE_MS = 15_000; // un fix devient « périmé » après 15 s.

export function useDriverPosition(): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null);
  const ref = useRef<Coords | null>(null);

  useEffect(() => {
    const handle = watchPosition(
      (next) => {
        const cur = ref.current;

        // Premier fix : on l'accepte pour afficher le point sans attendre.
        if (!cur) {
          ref.current = next;
          setCoords(next);
          return;
        }

        const fresh = next.timestamp - cur.timestamp < STALE_MS;
        // Relevé trop imprécis alors qu'on a déjà un fix frais → on ignore.
        if (next.accuracy > ACCURACY_GATE && fresh) return;
        // Nettement moins précis que l'actuel (encore frais) → on ignore.
        if (next.accuracy > cur.accuracy * 2 && fresh) return;

        const movedM =
          haversineKm(
            { lat: cur.latitude, lng: cur.longitude },
            { lat: next.latitude, lng: next.longitude }
          ) * 1000;

        // Anti-jitter : déplacement sous le bruit GPS et pas plus précis →
        // on garde le point immobile.
        const jitterThreshold = Math.max(4, next.accuracy * 0.5);
        if (movedM < jitterThreshold && next.accuracy >= cur.accuracy) return;

        ref.current = next;
        setCoords(next);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
    return () => handle?.stop();
  }, []);

  return coords;
}
