"use client";

import { useEffect, useState } from "react";
import {
  LOCATION_COOKIE,
  LOCATION_COOKIE_MAX_AGE,
  encodeLocationCookie,
} from "@/lib/customer/location-cookie";

// =============================================================================
// Localisation préférée du client (persistée en localStorage côté navigateur,
// et synchronisée avec `customers.default_*` si l'utilisateur est connecté).
// =============================================================================

export type CustomerLocation = {
  wilaya_code: string | null;
  commune: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * Adresse exacte LISIBLE (rue/quartier/commune) du point confirmé par le
   * client (GPS ou repère carte). Affichée telle quelle dans le header de la
   * marketplace pour que le client soit SÛR que sa position exacte est prise en
   * compte. `null` si seule une wilaya/commune a été choisie manuellement.
   */
  address: string | null;
  /**
   * Origine de la position :
   *   - "gps"    : détectée automatiquement → peut être RAFRAÎCHIE en arrière-
   *                plan au démarrage / à la reprise (position temps réel) ;
   *   - "manual" : zone/adresse CHOISIE par le client → ne JAMAIS l'écraser
   *                automatiquement (il a explicitement décidé) ;
   *   - null     : legacy (avant ce champ) → traité comme « ne pas rafraîchir »
   *                par prudence (on ne sait pas si c'était un choix manuel).
   */
  source: "gps" | "manual" | null;
  /** ISO date du dernier set (debug / "à jour depuis…"). */
  updated_at: string;
};

const STORAGE_KEY = "coligo:customer:location";

// -----------------------------------------------------------------------------
// Feuille « Où veux-tu commander ? » — il n'en existe QU'UNE, rendue par le
// header (`CustomerHeader`). Tout autre écran qui veut changer la position
// (ex. état vide « Aucun commerçant dans votre zone ») déclenche CETTE feuille
// via cet événement, au lieu de rendre son propre LocationPicker inline.
// -----------------------------------------------------------------------------

export const LOCATION_PICKER_OPEN_EVENT = "coligo:location:open-picker";

/** Ouvre la feuille de changement de position du header (même UX partout). */
export function openLocationPicker(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCATION_PICKER_OPEN_EVENT));
}

/**
 * Miroir de la position dans un cookie lisible par le SSR (voir location-cookie).
 * Permet à l'accueil de cibler les bannières AVEC la vraie position live dès le
 * rendu serveur. No-op hors navigateur. Best-effort (cookies désactivés → le SSR
 * retombe sur l'adresse enregistrée + repli client).
 */
function setLocationCookie(loc: CustomerLocation): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie =
      `${LOCATION_COOKIE}=${encodeLocationCookie(loc)}; ` +
      `path=/; max-age=${LOCATION_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookies bloqués (mode privé strict) — sans effet */
  }
}

export function readStoredLocation(): CustomerLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerLocation>;
    return {
      wilaya_code: parsed.wilaya_code ?? null,
      commune: parsed.commune ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      address: parsed.address ?? null,
      source: parsed.source ?? null,
      updated_at: parsed.updated_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeStoredLocation(loc: Partial<CustomerLocation>): void {
  if (typeof window === "undefined") return;
  const current = readStoredLocation() ?? {
    wilaya_code: null,
    commune: null,
    latitude: null,
    longitude: null,
    address: null,
    source: null,
    updated_at: new Date().toISOString(),
  };
  const merged: CustomerLocation = {
    ...current,
    ...loc,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  // Miroir cookie → le SSR de l'accueil cible les bannières sur cette position.
  setLocationCookie(merged);
  // Broadcast à d'autres composants/onglets (header, home, search).
  window.dispatchEvent(
    new CustomEvent("coligo:location:change", { detail: merged })
  );
}

// =============================================================================
// Cache DÉPART Coligo Drive — séparé de la localisation marketplace ci-dessus
// (qui peut être une adresse CHOISIE manuellement, à ne pas écraser). Ne sert
// qu'à amorcer INSTANTANÉMENT le départ GPS à la réouverture de Drive (surtout
// la PWA Drive ouverte directement) au lieu d'afficher « Localisation… ». Le
// watch haute précision corrige ensuite la position actuelle.
// =============================================================================

const DRIVE_DEP_KEY = "coligo:drive:departure";

export type DriveDeparture = {
  latitude: number;
  longitude: number;
  address: string | null;
  updated_at: string;
};

export function readDriveDeparture(): DriveDeparture | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRIVE_DEP_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DriveDeparture>;
    if (p.latitude == null || p.longitude == null) return null;
    return {
      latitude: p.latitude,
      longitude: p.longitude,
      address: p.address ?? null,
      updated_at: p.updated_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeDriveDeparture(
  latitude: number,
  longitude: number,
  address: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DRIVE_DEP_KEY,
      JSON.stringify({
        latitude,
        longitude,
        address,
        updated_at: new Date().toISOString(),
      })
    );
  } catch {
    /* quota / mode privé : sans effet, on retombera sur le GPS */
  }
}

/** Hook qui lit la localisation courante et se met à jour si elle change. */
export function useCustomerLocation(): CustomerLocation | null {
  const [loc, setLoc] = useState<CustomerLocation | null>(null);
  useEffect(() => {
    const stored = readStoredLocation();
    setLoc(stored);
    // Aligne le cookie SSR sur le localStorage dès le montage → les clients
    // déjà localisés (avant l'ajout du cookie) l'obtiennent sans rien changer,
    // et la prochaine navigation/refresh rend directement la bonne bannière.
    if (stored) setLocationCookie(stored);
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<CustomerLocation>;
      setLoc(ce.detail ?? readStoredLocation());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLoc(readStoredLocation());
    };
    window.addEventListener("coligo:location:change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("coligo:location:change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return loc;
}
