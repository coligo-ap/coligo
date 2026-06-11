/**
 * Géométrie « Je rentre chez moi » (checklist G4) : une demande est « vers le
 * domicile » si le cap pickup→destination s'écarte du cap pickup→domicile de
 * moins de la tolérance angulaire (config admin), OU si la destination
 * RAPPROCHE réellement du domicile. Le formatage des minutes en ligne (G2)
 * vit ici aussi.
 */

export type Pt = { lat: number; lng: number };

/** Cap initial (en degrés 0-360) du point a vers le point b. */
export function bearingDeg(a: Pt, b: Pt): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Écart angulaire minimal entre deux caps (0-180°). */
export function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const havKm = (a: Pt, b: Pt): number => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** La course pickup→dest va-t-elle « vers » home (tolérance en degrés) ? */
export function isTowardsHome(
  pickup: Pt,
  dest: Pt,
  home: Pt,
  toleranceDeg: number
): boolean {
  const closer = havKm(dest, home) < havKm(pickup, home) - 0.2;
  const sameDirection =
    angularDiff(bearingDeg(pickup, dest), bearingDeg(pickup, home)) <=
    toleranceDeg;
  return closer && sameDirection;
}

/** « 6 h 20 en ligne » à partir des minutes cumulées. */
export function formatOnline(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min en ligne`;
  return `${h} h ${String(m).padStart(2, "0")} en ligne`;
}

/** Clé localStorage du toggle « je rentre chez moi » (partagé entre écrans). */
export const HOME_DIR_KEY = "coligo_drive_home_dir_on";
