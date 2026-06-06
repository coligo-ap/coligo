"use client";

import { useEffect, useState } from "react";

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
  /** ISO date du dernier set (debug / "à jour depuis…"). */
  updated_at: string;
};

const STORAGE_KEY = "coligo:customer:location";

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
    updated_at: new Date().toISOString(),
  };
  const merged: CustomerLocation = {
    ...current,
    ...loc,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  // Broadcast à d'autres composants/onglets (header, home, search).
  window.dispatchEvent(
    new CustomEvent("coligo:location:change", { detail: merged })
  );
}

/** Hook qui lit la localisation courante et se met à jour si elle change. */
export function useCustomerLocation(): CustomerLocation | null {
  const [loc, setLoc] = useState<CustomerLocation | null>(null);
  useEffect(() => {
    setLoc(readStoredLocation());
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
