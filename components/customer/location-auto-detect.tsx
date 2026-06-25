"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  readStoredLocation,
  writeStoredLocation,
} from "@/lib/customer/location-store";
import { getPosition, geolocationSupported } from "@/lib/native";
import {
  reverseGeocode,
  updateCustomerLocation,
} from "@/app/(customer)/actions";
// Libellé d'adresse PRÉCIS (rue/quartier) pour le header.
import { reverseGeocode as reverseGeocodeAddress } from "@/lib/geo/geocode";
import { haversineKm } from "@/lib/delivery/distance";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";

// =============================================================================
// LocationAutoDetect — position GPS en arrière-plan : acquisition + refresh.
// =============================================================================
// Objectif (style Uber) : dès l'ouverture de l'app — ET surtout quand le client
// REVIENT après l'avoir fermée/mise en arrière-plan — récupérer/mettre à jour
// sa position EXACTE de façon transparente, pour que les règles de zone
// (proximité, tri, filtres, préchargement) s'appliquent sur une position FRAÎCHE.
//
// Deux modes :
//   1. ACQUISITION (aucune position connue) : tentative silencieuse si la
//      permission est "granted", un seul prompt si "prompt". On n'impose jamais
//      un dialog surprise ("unknown"/Safari → on attend un geste via le bandeau).
//   2. REFRESH (position GPS déjà connue) : à chaque montage + à chaque reprise
//      au premier plan (`useResumeResync`), on relit la position SILENCIEUSEMENT
//      (jamais de prompt) si la permission est "granted", et on met à jour la
//      zone si le client a bougé. Throttlé pour ne pas marteler le GPS/géocodage.
//
// Une position CHOISIE manuellement (source "manual") n'est JAMAIS écrasée : le
// client a explicitement décidé de sa zone. Les entrées legacy (source null) ne
// sont pas rafraîchies non plus, par prudence.
//
// Tout écrit via `writeStoredLocation` émet `coligo:location:change` → la home
// (`MarketplaceGrid` via TanStack Query) re-classe par proximité et le header se
// met à jour, sans rechargement de page.
// =============================================================================

const AUTO_SKIP_KEY = "coligo:geo:auto-skip";
// Ne pas rafraîchir plus d'une fois par fenêtre (reprises groupées au focus).
const REFRESH_THROTTLE_MS = 45_000;
// En deçà de ce déplacement, on NE réécrit PAS (évite un refetch inutile).
const MIN_MOVE_KM = 0.05; // 50 m

/** État de la permission Geolocation (sans jamais déclencher de prompt). */
async function readPermission(): Promise<PermissionState | "unknown"> {
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      return status.state;
    }
  } catch {
    /* Permissions API indisponible (Safari iOS ≤ 15) */
  }
  return "unknown";
}

/**
 * Reverse-géocode + persiste une position GPS (localStorage + DB si connecté).
 * `source: "gps"` → la position reste éligible aux refreshs ultérieurs.
 */
async function persistGpsPosition(latitude: number, longitude: number) {
  // Wilaya + commune (best-effort).
  let geo;
  try {
    geo = await reverseGeocode({ latitude, longitude });
  } catch {
    geo = { ok: false } as const;
  }
  const wilayaCode = geo.ok ? (geo.wilaya_code ?? null) : null;
  const commune = geo.ok ? (geo.commune ?? null) : null;

  // Adresse exacte lisible (best-effort) pour le header.
  let address: string | null = null;
  try {
    address = await reverseGeocodeAddress(latitude, longitude);
  } catch {
    /* géocodage indispo : le header retombe sur commune · wilaya */
  }

  writeStoredLocation({
    latitude,
    longitude,
    wilaya_code: wilayaCode,
    commune,
    address,
    source: "gps",
  });

  // Sync DB si l'user est connecté (no-op silencieux sinon).
  try {
    await updateCustomerLocation({
      latitude,
      longitude,
      wilaya_code: wilayaCode,
      commune,
    });
  } catch {
    /* offline / RLS — on garde la version locale */
  }
}

export function LocationAutoDetect() {
  // Sérialise les passages (un seul GPS en vol à la fois) + throttle temporel.
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(0);

  const run = useCallback(async (allowPrompt: boolean) => {
    if (typeof window === "undefined") return;
    if (!geolocationSupported()) return;
    if (inFlightRef.current) return;
    if (Date.now() - lastRunRef.current < REFRESH_THROTTLE_MS) return;

    const current = readStoredLocation();

    // Une zone choisie manuellement (ou une entrée legacy) ne se rafraîchit pas
    // automatiquement : le client a décidé, on ne lui reprend pas la main.
    const hasPosition =
      !!current && (current.latitude != null || !!current.wilaya_code);
    if (hasPosition && current?.source !== "gps") return;

    const permission = await readPermission();

    if (!hasPosition) {
      // ACQUISITION. Refusé → bandeau legacy. Inconnu (Safari) → pas de prompt
      // surprise. Prompt → seulement sur un montage (jamais sur une reprise).
      if (permission === "denied") return;
      if (permission === "unknown") return;
      if (permission === "prompt" && !allowPrompt) return;
      if (window.localStorage.getItem(AUTO_SKIP_KEY) === "1") return;
    } else {
      // REFRESH SILENCIEUX : uniquement si déjà autorisé (jamais de prompt).
      if (permission !== "granted") return;
    }

    inFlightRef.current = true;
    lastRunRef.current = Date.now();
    try {
      let coords;
      try {
        // Rapide (pas de haute précision au load) ; tolère une position récente.
        coords = await getPosition({
          enableHighAccuracy: false,
          timeout: 8_000,
          maximumAge: 60_000,
        });
      } catch {
        // Acquisition refusée → on n'insiste plus de la session. Refresh échoué
        // (permission accordée) → on ne désactive rien, on retentera à la reprise.
        if (!hasPosition) {
          try {
            window.localStorage.setItem(AUTO_SKIP_KEY, "1");
          } catch {
            /* localStorage plein / privé — ignore */
          }
        }
        return;
      }

      // Refresh : si le client n'a quasiment pas bougé, on évite le re-géocodage
      // et le refetch (pas de churn). On rafraîchit quand même la zone si elle
      // manquait (coords sans wilaya).
      if (
        hasPosition &&
        current?.latitude != null &&
        current?.longitude != null &&
        current?.wilaya_code
      ) {
        const movedKm = haversineKm(
          { lat: current.latitude, lng: current.longitude },
          { lat: coords.latitude, lng: coords.longitude }
        );
        if (movedKm < MIN_MOVE_KM) return;
      }

      await persistGpsPosition(coords.latitude, coords.longitude);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Au montage : acquisition (prompt autorisé) ou 1er refresh.
  useEffect(() => {
    void run(true);
  }, [run]);

  // À la reprise au premier plan (retour dans l'app) : refresh SILENCIEUX.
  useResumeResync(() => {
    void run(false);
  });

  return null;
}
