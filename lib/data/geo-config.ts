import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Config Adresses/Prix (Partie E du prompt) — lecture serveur.
// Les VALEURS GLOBALES vivent dans platform_settings (colonnes, mig 0233) ; une
// surcharge PAR VILLE peut venir de settings_city_overrides (résolution
// commune > wilaya > global, via la RPC setting_city_override).
//
// RÈGLE 2 (« aucune valeur hardcodée ») : tous les appelants — recherche
// d'adresse, fallback Google, reverse-géocodage, devis — lisent ICI, jamais une
// constante en dur. RÈGLE 3 (« multi-ville ») : passer { wilaya, commune } pour
// obtenir les valeurs propres à la localité.
// =============================================================================

export type GeoConfig = {
  addressSuggestionsMax: number;
  addressSearchDebounceMs: number;
  reverseGeocodeDebounceMs: number;
  cacheTtlGoogleS: number;
  cacheTtlFreeS: number;
  googleMinQlen: number;
  googleDailyGlobal: number;
  googleDailyPerUser: number;
  geocodeGoogleEnabled: boolean;
  quoteTtlS: number;
  providerPriority: { id: string; enabled: boolean }[];
  confidenceScoreWeights: {
    precision: number;
    provider_success: number;
    quality: number;
    validation: number;
  };
};

// Defaults = exactement les colonnes par défaut de la mig 0233 (filet si la
// ligne platform_settings est absente — ne doit jamais arriver en prod).
export const GEO_CONFIG_DEFAULTS: GeoConfig = {
  addressSuggestionsMax: 8,
  addressSearchDebounceMs: 450,
  reverseGeocodeDebounceMs: 300,
  cacheTtlGoogleS: 2592000,
  cacheTtlFreeS: 86400,
  googleMinQlen: 5,
  googleDailyGlobal: 500,
  googleDailyPerUser: 25,
  geocodeGoogleEnabled: true,
  quoteTtlS: 300,
  providerPriority: [
    { id: "gazetteer", enabled: true },
    { id: "merchants", enabled: true },
    { id: "photon", enabled: true },
    { id: "nominatim", enabled: true },
    { id: "google", enabled: true },
  ],
  confidenceScoreWeights: {
    precision: 0.4,
    provider_success: 0.2,
    quality: 0.2,
    validation: 0.2,
  },
};

// Mapping colonne SQL → champ typé.
const COLS = {
  address_suggestions_max: "addressSuggestionsMax",
  address_search_debounce_ms: "addressSearchDebounceMs",
  reverse_geocode_debounce_ms: "reverseGeocodeDebounceMs",
  cache_ttl_google_s: "cacheTtlGoogleS",
  cache_ttl_free_s: "cacheTtlFreeS",
  google_min_qlen: "googleMinQlen",
  google_daily_global: "googleDailyGlobal",
  google_daily_per_user: "googleDailyPerUser",
  geocode_google_enabled: "geocodeGoogleEnabled",
  quote_ttl_s: "quoteTtlS",
  provider_priority: "providerPriority",
  confidence_score_weights: "confidenceScoreWeights",
} as const;

export type GeoScope = { wilaya?: string | null; commune?: string | null };

/**
 * Config géo résolue. Lit les valeurs globales (1 SELECT) puis, si un périmètre
 * ville est fourni, applique les surcharges par clé (1 RPC par clé surchargée
 * possible — best-effort, jamais bloquant). Sans { wilaya }, renvoie le global.
 */
export async function getGeoConfig(scope?: GeoScope): Promise<GeoConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select(Object.keys(COLS).join(", "))
    .eq("id", true)
    .maybeSingle();

  const cfg: GeoConfig = { ...GEO_CONFIG_DEFAULTS };
  const row = (data ?? {}) as Record<string, unknown>;
  for (const [col, field] of Object.entries(COLS)) {
    const v = row[col];
    if (v !== undefined && v !== null) {
      // @ts-expect-error — assignation dynamique homogène au type de la colonne.
      cfg[field] = v;
    }
  }

  // Surcharges par ville (commune > wilaya > global). Best-effort.
  const wilaya = scope?.wilaya ?? null;
  if (wilaya) {
    const commune = scope?.commune ?? null;
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown }>;
    await Promise.all(
      (Object.keys(COLS) as (keyof typeof COLS)[]).map(async (col) => {
        try {
          const { data: ov } = await rpc("setting_city_override", {
            p_key: col,
            p_wilaya: wilaya,
            p_commune: commune,
          });
          if (ov !== null && ov !== undefined) {
            // @ts-expect-error — assignation dynamique homogène.
            cfg[COLS[col]] = ov;
          }
        } catch {
          /* override best-effort */
        }
      })
    );
  }

  return cfg;
}
