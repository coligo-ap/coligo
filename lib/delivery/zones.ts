/**
 * Zones de forte demande (carte livreur) — types + métadonnées partagés.
 *
 * Les zones sont calculées côté DB (RPC `delivery_demand_zones`, mig 0093) :
 * agrégat anti-fuite (lat/lng de cellule + compte, aucune donnée personnelle).
 * Aucune zone n'est renvoyée en activité normale ; sinon trois intensités.
 */

export type DemandLevel = "medium" | "high" | "very_high";

export type DemandZone = {
  lat: number;
  lng: number;
  cnt: number;
  level: DemandLevel;
};

export const DEMAND_LEVEL_META: Record<
  DemandLevel,
  { label: string; color: string; weight: 1 | 2 | 3 }
> = {
  medium: { label: "Demande moyenne", color: "#f59e0b", weight: 1 },
  high: { label: "Forte demande", color: "#f97316", weight: 2 },
  very_high: { label: "Très forte demande", color: "#ef4444", weight: 3 },
};

/** Construit le FeatureCollection GeoJSON consommé par la couche MapLibre. */
export function zonesToGeoJSON(zones: DemandZone[]) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => {
      const meta = DEMAND_LEVEL_META[z.level];
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [z.lng, z.lat],
        },
        properties: {
          color: meta.color,
          w: meta.weight,
          cnt: z.cnt,
          label: String(z.cnt),
        },
      };
    }),
  };
}
