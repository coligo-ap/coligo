import { isTowardsHome } from "@/lib/drive/geo";

/**
 * Filtre d'affichage PARTAGÉ des demandes côté chauffeur — utilisé À LA FOIS par
 * l'Accueil (compteur + popup) et la page Demandes, pour qu'ils montrent
 * EXACTEMENT le même ensemble. Avant, le compteur de l'Accueil comptait toutes
 * les courses proches (sans le filtre « je rentre chez moi », sans exclure les
 * déjà-proposées) tandis que la liste, elle, filtrait → « 5 sur l'accueil mais
 * 0 dans Drive ». Une seule source de vérité = plus d'incohérence.
 */

export type HomeDirFilter = {
  /** « Je rentre chez moi » actif ? */
  on: boolean;
  homeLat: number | null;
  homeLng: number | null;
  /** Tolérance angulaire (degrés, config admin). */
  tolerance: number;
};

type RideGeo = {
  pickup_lat: number | null;
  pickup_lng: number | null;
  dest_lat: number | null;
  dest_lng: number | null;
};

/**
 * La course passe-t-elle le filtre « je rentre chez moi » ? true si le filtre est
 * inactif (ou domicile/coords manquants) — sinon true seulement si la course va
 * vers le domicile (cap + rapprochement, cf. isTowardsHome).
 */
export function passesHomeDir(ride: RideGeo, f: HomeDirFilter): boolean {
  const active = f.on && f.homeLat != null && f.homeLng != null;
  if (!active) return true;
  if (
    ride.pickup_lat == null ||
    ride.pickup_lng == null ||
    ride.dest_lat == null ||
    ride.dest_lng == null
  ) {
    return true; // pas de coords → on n'exclut pas par prudence
  }
  return isTowardsHome(
    { lat: ride.pickup_lat, lng: ride.pickup_lng },
    { lat: ride.dest_lat, lng: ride.dest_lng },
    { lat: f.homeLat as number, lng: f.homeLng as number },
    f.tolerance
  );
}

/**
 * Une « demande ouverte » = pas encore proposée par moi ET conforme au filtre
 * « je rentre chez moi ». C'est l'unité comptée sur l'Accueil et listée dans
 * « Demandes » (le compteur de l'Accueil DOIT égaler la liste).
 */
export function isOpenDemande(
  ride: RideGeo & { my_offer_da: number | null },
  f: HomeDirFilter
): boolean {
  return ride.my_offer_da == null && passesHomeDir(ride, f);
}

export type PushChauffeur = {
  /** Distance départ de la course → chauffeur (km). */
  distKm: number;
  /** Rayon choisi (« ma zone »), null = non personnalisé. */
  radiusKm: number | null;
  /** « Je rentre chez moi » actif (état serveur). */
  homeDirActive: boolean;
  homeLat: number | null;
  homeLng: number | null;
  tolerance: number;
};

/**
 * Un chauffeur doit-il être NOTIFIÉ d'une nouvelle course ? Mêmes règles que ce
 * qu'il verra dans sa liste : course dans SON rayon (work_zone_radius_km clampé
 * 5..20 ; null = pas de restriction de rayon ici, comportement historique) ET
 * conforme à « je rentre chez moi » s'il est actif. Fonction PURE → réutilisée
 * par le trigger FCM serveur (lib/fcm/triggers.ts) et testable.
 */
export function isPushEligible(ride: RideGeo, ch: PushChauffeur): boolean {
  if (ch.radiusKm != null) {
    const r = Math.min(20, Math.max(5, ch.radiusKm));
    if (ch.distKm > r) return false;
  }
  return passesHomeDir(ride, {
    on: ch.homeDirActive,
    homeLat: ch.homeLat,
    homeLng: ch.homeLng,
    tolerance: ch.tolerance,
  });
}
