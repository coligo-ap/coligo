/**
 * Distance Haversine — calcul de distance à vol d'oiseau entre 2 points
 * lat/lng en kilomètres. Précision suffisante pour la livraison locale
 * (rayon < 50 km). Pour des distances plus longues, passer à un service
 * de routage (Mapbox Directions, OSRM…) — pas nécessaire au MVP.
 *
 * Pure : pas d'I/O, callable côté serveur ET client.
 */

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Ordonne une liste de points par proximité à partir d'un point d'origine
 * (algorithme greedy nearest-neighbor). Approximation acceptable pour des
 * tournées de quelques arrêts ; pour optimiser sérieusement → solveur TSP.
 */
export function orderByNearest<T extends { lat: number; lng: number }>(
  origin: { lat: number; lng: number },
  points: T[]
): T[] {
  const remaining = [...points];
  const ordered: T[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    current = next;
  }
  return ordered;
}
