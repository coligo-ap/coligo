import { haversineKm } from "@/lib/delivery/distance";

/**
 * Itinéraire routier (suit les rues) façon UberEats/Yassir, via OSRM public.
 *
 * - `fetchRoute` interroge le serveur OSRM de démo (gratuit, sans clé, CORS OK)
 *   et renvoie le tracé GeoJSON + la distance et la durée RÉELLES de conduite.
 * - Si OSRM est lent/indisponible, on retombe sur une ligne droite + une ETA
 *   estimée à vitesse urbaine moyenne — aucune régression, jamais d'exception.
 * - Pur côté client : appelable depuis n'importe quel composant.
 */

type LatLng = { lat: number; lng: number };

/** Coordonnées au format GeoJSON/MapLibre : [lng, lat]. */
export type LngLat = [number, number];

export type RoutePath = {
  /** Tracé à dessiner sur la carte ([lng, lat], …). */
  coordinates: LngLat[];
  /** Distance de conduite (km) — réelle si OSRM, à vol d'oiseau sinon. */
  distanceKm: number;
  /** Durée estimée en minutes. */
  durationMin: number;
  /** D'où vient le tracé : routage réel ou repli ligne droite. */
  source: "osrm" | "fallback";
};

// Vitesse urbaine moyenne pour l'ETA de repli (cohérent avec lib/delivery/eta.ts).
const FALLBACK_SPEED_KMH = 18;
const OSRM_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; path: RoutePath }>();

function key(from: LatLng, to: LatLng): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(from.lat)},${r(from.lng)}->${r(to.lat)},${r(to.lng)}`;
}

function fallbackPath(from: LatLng, to: LatLng): RoutePath {
  const distanceKm = haversineKm(from, to);
  return {
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    distanceKm,
    durationMin: Math.max(1, Math.ceil((distanceKm / FALLBACK_SPEED_KMH) * 60)),
    source: "fallback",
  };
}

/**
 * Calcule l'itinéraire routier entre deux points. Ne rejette jamais : en cas
 * d'échec réseau/timeout, renvoie le repli ligne droite.
 */
export async function fetchRoute(from: LatLng, to: LatLng): Promise<RoutePath> {
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.path;

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`osrm_${res.status}`);
    const json = (await res.json()) as {
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: LngLat[] };
      }[];
    };
    const route = json.routes?.[0];
    if (!route || !route.geometry?.coordinates?.length) {
      throw new Error("osrm_empty");
    }
    const path: RoutePath = {
      coordinates: route.geometry.coordinates,
      distanceKm: route.distance / 1000,
      durationMin: Math.max(1, Math.ceil(route.duration / 60)),
      source: "osrm",
    };
    cache.set(k, { at: Date.now(), path });
    return path;
  } catch {
    const path = fallbackPath(from, to);
    // On met aussi le repli en cache (TTL) pour ne pas re-tenter OSRM en boucle
    // quand il est indisponible.
    cache.set(k, { at: Date.now(), path });
    return path;
  } finally {
    clearTimeout(timer);
  }
}
