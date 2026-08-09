"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  readStoredLocation,
  writeStoredLocation,
} from "@/lib/customer/location-store";
import {
  getPosition,
  geolocationSupported,
  readGeoPermission,
} from "@/lib/native";
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
// Une position CHOISIE manuellement (source "manual") n'est jamais écrasée EN
// COURS DE SESSION : le client vient de décider, on ne lui reprend pas la main.
// MAIS à l'OUVERTURE de l'app/du site (nouvelle session navigateur), la règle
// produit est « par défaut = position ACTUELLE » : si la permission est déjà
// accordée, on repart du GPS réel, même si la session précédente s'était
// terminée sur une zone choisie manuellement. Les entrées legacy (source null)
// suivent la même logique.
//
// Tout écrit via `writeStoredLocation` émet `coligo:location:change` → la home
// (`MarketplaceGrid` via TanStack Query) re-classe par proximité et le header se
// met à jour, sans rechargement de page.
// =============================================================================

// Marqueur « on a déjà essayé et échoué » — en sessionStorage, PAS en
// localStorage : la règle produit est « à CHAQUE ouverture de l'app, on
// détecte la position actuelle ». Un refus ne doit donc pas éteindre la
// détection pour toujours ; il éteint seulement les tentatives restantes de
// CETTE session, et la prochaine ouverture retente.
const AUTO_SKIP_KEY = "coligo:geo:auto-skip";
// Marqueur « boot de session » (sessionStorage, par onglet) : posé après le
// premier passage → les montages suivants ne re-forcent plus le GPS sur un
// choix manuel fait PENDANT la session.
const BOOT_DONE_KEY = "coligo:geo:boot-done";
// Ne pas rafraîchir plus d'une fois par fenêtre (reprises groupées au focus).
const REFRESH_THROTTLE_MS = 45_000;
// En deçà de ce déplacement, on NE réécrit PAS (évite un refetch inutile).
const MIN_MOVE_KM = 0.05; // 50 m
// Absence (app en arrière-plan) au-delà de laquelle un RETOUR au premier plan est
// traité comme une RÉOUVERTURE : on reprend la position GPS réelle comme défaut,
// même par-dessus une zone choisie manuellement (règle produit « à la réouverture
// = position actuelle »). En deçà (micro-bascule : dialog de permission, feuille
// de partage, coup d'œil dans une autre app), on respecte le choix manuel en
// cours. Aligné sur le seuil « longue absence » de useResumeResync.
const REOPEN_GRACE_MS = 30_000;

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

  const run = useCallback(async (allowPrompt: boolean, resumeAwayMs = 0) => {
    if (typeof window === "undefined") return;
    if (!geolocationSupported()) return;
    if (inFlightRef.current) return;
    if (Date.now() - lastRunRef.current < REFRESH_THROTTLE_MS) return;

    const current = readStoredLocation();

    const hasPosition =
      !!current && (current.latitude != null || !!current.wilaya_code);

    // Boot de session (ouverture de l'app/du site dans cet onglet) ?
    let isBoot = false;
    try {
      isBoot = window.sessionStorage.getItem(BOOT_DONE_KEY) !== "1";
      if (isBoot) window.sessionStorage.setItem(BOOT_DONE_KEY, "1");
    } catch {
      /* sessionStorage indispo — on reste sur le comportement de session */
    }

    // RÉOUVERTURE ? Démarrage à froid (nouvelle session : sessionStorage vide)
    // OU retour au premier plan après une absence > grâce (l'app a été fermée /
    // mise en arrière-plan un moment). Dans ces cas, la règle produit est « par
    // défaut = position ACTUELLE ».
    const reopen = isBoot || resumeAwayMs > REOPEN_GRACE_MS;

    // Une zone choisie manuellement (ou legacy) ne se rafraîchit pas EN COURS DE
    // SESSION (le client vient de décider, on ne lui reprend pas la main). MAIS à
    // la RÉOUVERTURE, on repart de la position GPS RÉELLE comme défaut, même
    // par-dessus un choix manuel — silencieusement, uniquement si la permission
    // est déjà accordée (jamais de prompt par-dessus un choix manuel).
    if (hasPosition && current?.source !== "gps" && !reopen) return;

    // Permission lue par le socle NATIF quand on tourne en APK : dans le
    // WebView, `navigator.permissions` ne reflète PAS le grant Android runtime
    // (il répondait « unknown » → l'app native ne détectait JAMAIS la position
    // à la première utilisation, le bug que corrige ce passage).
    const permission = await readGeoPermission();

    if (!hasPosition) {
      // ACQUISITION. Refusé → bandeau legacy (l'OS ne réafficherait rien).
      if (permission === "denied") return;
      // « unknown » (Safari ancien, Permissions API absente) : impossible de
      // savoir sans demander. À la PREMIÈRE UTILISATION on tente quand même —
      // c'est la règle produit (« détecter la position dès l'ouverture ») et la
      // tentative EST la demande. Jamais sur une reprise en arrière-plan.
      if (permission === "unknown" && !allowPrompt) return;
      if (permission === "prompt" && !allowPrompt) return;
      // Déjà tenté et échoué DANS CETTE session → on n'insiste plus ici (la
      // prochaine ouverture de l'app retentera).
      if (window.sessionStorage.getItem(AUTO_SKIP_KEY) === "1") return;
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
            window.sessionStorage.setItem(AUTO_SKIP_KEY, "1");
          } catch {
            /* sessionStorage indispo — ignore */
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

  // À la reprise au premier plan : refresh SILENCIEUX. On transmet la durée
  // d'absence → une reprise après une absence > grâce est traitée comme une
  // réouverture (reprend la position GPS réelle, même sur une zone manuelle).
  useResumeResync((hiddenMs) => {
    void run(false, hiddenMs);
  });

  return null;
}
