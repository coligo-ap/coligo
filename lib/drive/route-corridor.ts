import { WILAYA_CENTROIDS } from "@/lib/config/wilaya-centroids";
import { nearestWilayaCode } from "@/lib/drive/interwilaya";

/**
 * Détection AUTOMATIQUE des arrêts « sur la route » d'un covoiturage :
 * quelles wilayas le trajet traverse-t-il ? (ex. Béjaïa → Alger passe par
 * Bouira). 100 % locale et pure : on projette les 58 chefs-lieux sur le tracé
 * ROUTIER (polyline OSRM quand elle est là, segment droit en repli) et on garde
 * ceux à moins de `maxOffKm` de la route, ordonnés par km depuis l'origine.
 * L'app SUGGÈRE, le chauffeur active d'un tap — jamais d'arrêt imposé.
 */

export type LatLngPt = { lat: number; lng: number };

export type CorridorStop = {
  /** Code wilaya (58). */
  code: string;
  lat: number;
  lng: number;
  /** Position le long du trajet (km depuis l'origine) — donne l'ORDRE. */
  alongKm: number;
  /** Écart à la route (km) — plus c'est petit, plus c'est « sur le chemin ». */
  offKm: number;
};

const KY = 110.57; // km / degré de latitude
const kx = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Distance point→segment en km (équirectangulaire) + abscisse du projeté. */
function projectOnSegment(
  p: LatLngPt,
  a: LatLngPt,
  b: LatLngPt
): { distKm: number; tKm: number } {
  const kxRef = kx(a.lat);
  const ax = a.lng * kxRef;
  const ay = a.lat * KY;
  const bx = b.lng * kxRef;
  const by = b.lat * KY;
  const px = p.lng * kxRef;
  const py = p.lat * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return {
    distKm: Math.hypot(px - qx, py - qy),
    tKm: t * Math.hypot(dx, dy),
  };
}

/**
 * Wilayas traversées par le trajet, ordonnées par km depuis l'origine.
 * `path` = polyline routière OSRM (ou null → segment droit origine→destination).
 * Les wilayas de l'origine et de la destination sont exclues, ainsi que les
 * points trop proches des extrémités (< 15 km) — un « arrêt » au départ n'en
 * est pas un.
 */
export function suggestCorridorStops(
  path: LatLngPt[] | null,
  from: LatLngPt,
  to: LatLngPt,
  maxOffKm = 30
): CorridorStop[] {
  // Polyline de travail : OSRM sous-échantillonnée (perf), sinon la droite.
  let line: LatLngPt[] = path && path.length >= 2 ? path : [from, to];
  if (line.length > 200) {
    const step = Math.ceil(line.length / 200);
    line = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  }
  // Km cumulés au début de chaque segment.
  const cumKm: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    const seg = projectOnSegment(line[i], line[i - 1], line[i]);
    cumKm.push(cumKm[i - 1] + seg.tKm);
  }
  const totalKm = cumKm[cumKm.length - 1];

  const fromW = nearestWilayaCode(from.lat, from.lng);
  const toW = nearestWilayaCode(to.lat, to.lng);
  const out: CorridorStop[] = [];
  for (const [code, c] of Object.entries(WILAYA_CENTROIDS)) {
    if (code === fromW || code === toW) continue;
    let best: { distKm: number; alongKm: number } | null = null;
    for (let i = 1; i < line.length; i++) {
      const pr = projectOnSegment(c, line[i - 1], line[i]);
      if (!best || pr.distKm < best.distKm) {
        best = { distKm: pr.distKm, alongKm: cumKm[i - 1] + pr.tKm };
      }
    }
    if (
      best &&
      best.distKm <= maxOffKm &&
      best.alongKm > 15 &&
      best.alongKm < totalKm - 15
    ) {
      out.push({
        code,
        lat: c.lat,
        lng: c.lng,
        alongKm: Math.round(best.alongKm),
        offKm: Math.round(best.distKm),
      });
    }
  }
  return out.sort((a, b) => a.alongKm - b.alongKm).slice(0, 6);
}
