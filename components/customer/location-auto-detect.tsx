"use client";

import { useEffect, useRef } from "react";
import {
  readStoredLocation,
  writeStoredLocation,
} from "@/lib/customer/location-store";
import { getPosition, geolocationSupported } from "@/lib/native";
import {
  reverseGeocode,
  updateCustomerLocation,
} from "@/app/(customer)/actions";

// =============================================================================
// LocationAutoDetect — tente une détection silencieuse au chargement.
// =============================================================================
// Stratégie (sans bandeau ni prompt intrusif) :
//   1. Si une wilaya est déjà stockée → no-op (l'ancienne position est gardée
//      et la home filtre dessus comme avant).
//   2. Sinon, on lit l'état de la permission Geolocation :
//        - "granted"  → on tente getPosition() silencieusement.
//        - "prompt"   → on tente quand même (un seul prompt navigateur, à la
//          première visite). Si refusé, on n'insiste plus (`auto-skip` flag).
//        - "denied"   → on ne touche à rien, le bandeau legacy reste visible.
//   3. Coords obtenues → reverseGeocode → on stocke wilaya/commune/coords.
//
// La home (`MarketplaceGrid`) écoute l'event `coligo:location:change` et
// rafraîchit automatiquement la liste des commerces dès qu'on écrit.
// =============================================================================

const AUTO_SKIP_KEY = "coligo:geo:auto-skip";

export function LocationAutoDetect() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      // 1) Déjà une wilaya stockée → on garde l'ancienne position.
      const current = readStoredLocation();
      if (current?.wilaya_code) return;

      // 2) Permissions navigateur.
      if (!geolocationSupported()) return;
      if (typeof window === "undefined") return;
      if (window.localStorage.getItem(AUTO_SKIP_KEY) === "1") return;

      let state: PermissionState | "unknown" = "unknown";
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({
            name: "geolocation" as PermissionName,
          });
          state = status.state;
        }
      } catch {
        // Permissions API indisponible (Safari iOS ≤ 15) → on saute en mode
        // "prompt" passif : on ne tente pas (évite le dialog surprise).
        state = "unknown";
      }

      // Si le navigateur sait que c'est refusé → rien à faire, on laisse le
      // bandeau legacy reprendre la main.
      if (state === "denied") return;
      // Si on ne sait pas (Safari) → on ne déclenche PAS de prompt natif
      // surprise au load. L'utilisateur peut toujours cliquer le bandeau.
      if (state === "unknown") return;

      // 3) Tentative GPS — silencieuse si "granted", un seul prompt si
      // "prompt". On évite enableHighAccuracy au load pour rester rapide.
      let coords;
      try {
        coords = await getPosition({
          enableHighAccuracy: false,
          timeout: 8_000,
          maximumAge: 60_000,
        });
      } catch {
        // Permission refusée ou indispo → on mémorise pour ne pas redemander
        // à chaque page de la session.
        try {
          window.localStorage.setItem(AUTO_SKIP_KEY, "1");
        } catch {
          /* localStorage plein / privé — ignore */
        }
        return;
      }

      // 4) Reverse-geocode → wilaya + commune (best-effort).
      let geo;
      try {
        geo = await reverseGeocode({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      } catch {
        geo = { ok: false } as const;
      }

      const wilayaCode = geo.ok ? (geo.wilaya_code ?? null) : null;
      const commune = geo.ok ? (geo.commune ?? null) : null;

      // 5) On stocke (au minimum les coords, même si la wilaya n'a pas matché
      // — la home pourra trier par proximité GPS).
      writeStoredLocation({
        latitude: coords.latitude,
        longitude: coords.longitude,
        wilaya_code: wilayaCode,
        commune,
      });

      // Sync DB si l'user est connecté (no-op silencieux sinon).
      try {
        await updateCustomerLocation({
          latitude: coords.latitude,
          longitude: coords.longitude,
          wilaya_code: wilayaCode,
          commune,
        });
      } catch {
        /* offline / RLS — on garde la version locale */
      }
    })();
  }, []);

  return null;
}
