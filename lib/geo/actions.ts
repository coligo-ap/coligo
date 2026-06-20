"use server";

import { getGeoConfig } from "@/lib/data/geo-config";

// =============================================================================
// Config géo CÔTÉ CLIENT (Partie B/E) — valeurs non sensibles utilisées par les
// composants carte : debounce de la recherche d'adresse, debounce du reverse-
// géocodage au déplacement de l'épingle, nombre de suggestions. Lues depuis
// /admin/config (RÈGLE 2 : aucune valeur en dur côté UI).
// =============================================================================

export type GeoClientConfig = {
  addressSearchDebounceMs: number;
  reverseGeocodeDebounceMs: number;
  addressSuggestionsMax: number;
};

export async function getGeoClientConfig(): Promise<GeoClientConfig> {
  const cfg = await getGeoConfig();
  return {
    addressSearchDebounceMs: cfg.addressSearchDebounceMs,
    reverseGeocodeDebounceMs: cfg.reverseGeocodeDebounceMs,
    addressSuggestionsMax: cfg.addressSuggestionsMax,
  };
}
