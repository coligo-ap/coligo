/**
 * Détection « Inter-wilayas » (longs trajets entre wilayas, façon
 * InDrive/Yassir) — 100 % LOCALE et PURE (partagée client + chauffeur,
 * zéro appel réseau, zéro colonne DB) : wilaya = plus proche centroïde
 * (lib/config/wilaya-centroids), inter = wilayas DIFFÉRENTES + trajet
 * assez long pour écarter les faux positifs de frontière.
 *
 * Usage : badge/onglet informatif des deux côtés (jamais tarifaire — le prix
 * reste l'offre libre du client, jugée par request_ride).
 */
import { WILAYA_CENTROIDS } from "@/lib/config/wilaya-centroids";
import { WILAYAS } from "@/lib/config/wilayas";

/** Trajet minimal (km) pour qualifier un inter-wilayas : sous ce seuil, un
 *  saut de frontière (ex. Alger ⇄ banlieue limitrophe) reste un trajet ville. */
const MIN_INTER_KM = 35;

/** Wilaya la plus proche d'un point (centroïde chef-lieu). */
export function nearestWilayaCode(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: string | null = null;
  let bestD = Infinity;
  // Distance équirectangulaire (suffisant pour un plus-proche-voisin).
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const [code, c] of Object.entries(WILAYA_CENTROIDS)) {
    const dLat = c.lat - lat;
    const dLng = (c.lng - lng) * cos;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}

export type InterWilaya = {
  /** Libellé « Alger → Béjaïa » (fr) */
  label: string;
  /** Libellé « الجزائر ← بجاية » (ar, flèche logique RTL gérée par le rendu) */
  labelAr: string;
};

/**
 * `null` si le trajet n'est pas inter-wilayas (points manquants, même wilaya,
 * ou trop court). Sinon les libellés prêts à afficher.
 */
export function interWilayaInfo(
  pickup: { lat: number; lng: number } | null | undefined,
  dest: { lat: number; lng: number } | null | undefined,
  km: number
): InterWilaya | null {
  if (!pickup || !dest || !(km >= MIN_INTER_KM)) return null;
  const from = nearestWilayaCode(pickup.lat, pickup.lng);
  const to = nearestWilayaCode(dest.lat, dest.lng);
  if (!from || !to || from === to) return null;
  const wFrom = WILAYAS.find((w) => w.code === from);
  const wTo = WILAYAS.find((w) => w.code === to);
  if (!wFrom || !wTo) return null;
  return {
    label: `${wFrom.name} → ${wTo.name}`,
    labelAr: `${wFrom.name_ar} ← ${wTo.name_ar}`,
  };
}
