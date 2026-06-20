"use client";

import { useEffect, useState } from "react";
import { getGeoClientConfig, type GeoClientConfig } from "@/lib/geo/actions";

// =============================================================================
// Hook client : config géo (debounce recherche/reverse, nb suggestions) lue une
// seule fois et mémoïsée au niveau module (partagée par tous les composants
// carte). Renvoie les défauts tant que la valeur réelle n'est pas chargée — la
// carte ne bloque JAMAIS sur ce fetch (RÈGLE 2 sans régression de perf).
// =============================================================================

const DEFAULTS: GeoClientConfig = {
  addressSearchDebounceMs: 450,
  reverseGeocodeDebounceMs: 450,
  addressSuggestionsMax: 8,
};

let cached: GeoClientConfig | null = null;
let inflight: Promise<GeoClientConfig> | null = null;

function load(): Promise<GeoClientConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getGeoClientConfig()
      .then((c) => {
        cached = c;
        return c;
      })
      .catch(() => DEFAULTS);
  }
  return inflight;
}

export function useGeoClientConfig(): GeoClientConfig {
  const [cfg, setCfg] = useState<GeoClientConfig>(cached ?? DEFAULTS);
  useEffect(() => {
    let alive = true;
    void load().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}
