import { haversineKm } from "@/lib/delivery/distance";

/**
 * Modèle « scooter » — source de vérité UNIQUE de l'ETA livreur.
 *
 * Les livreurs Coligo roulent quasi tous en scooter/moto : en ville dense
 * (Alger, feux, remontées de file) leur vitesse EFFECTIVE tourne autour de
 * 22 km/h — plus rapide qu'une voiture coincée dans le trafic, mais bornée par
 * les arrêts. On centralise ici cette conversion km → minutes pour que TOUS les
 * écrans (offre, demandes, carte offre, carte navigation) affichent le même
 * temps, cohérent avec le vrai itinéraire routier (OSRM) qui, lui, ne donne
 * qu'une durée « voiture ».
 *
 * Avant : trois constantes divergentes (`KM_TO_MIN = 5` → 12 km/h dans l'offre
 * et les demandes, `AVG_SPEED_KMH = 18` dans l'ETA client, durée voiture OSRM
 * dans les cartes) → le livreur voyait 3 temps différents pour une même course.
 */

type LatLng = { lat: number; lng: number };

/** Vitesse effective d'un scooter de livraison en ville (km/h). */
export const SCOOTER_SPEED_KMH = 22;

/**
 * Temps de manutention au retrait (attente commerçant + prise en charge) à
 * ajouter au trajet quand on estime la course COMPLÈTE (retrait → livraison).
 */
export const PICKUP_HANDLING_MIN = 3;

/** Convertit une distance (km) en minutes de conduite scooter (mini 1 min). */
export function scooterTravelMin(distanceKm: number | null): number {
  if (distanceKm == null || distanceKm <= 0) return 1;
  return Math.max(1, Math.ceil((distanceKm / SCOOTER_SPEED_KMH) * 60));
}

/**
 * ETA d'une course complète depuis la position du livreur : trajet vers le
 * commerçant + manutention + trajet commerçant → client. Distances à vol
 * d'oiseau (estimation rapide avant l'itinéraire routier). `me`/`pickup`/`drop`
 * peuvent être null : on additionne ce qu'on connaît.
 */
export function scooterCourseEta(
  me: LatLng | null,
  pickup: LatLng | null,
  drop: LatLng | null
): { km: number; min: number } | null {
  const legPickup = me && pickup ? haversineKm(me, pickup) : null;
  const legDrop = pickup && drop ? haversineKm(pickup, drop) : null;
  if (legPickup == null && legDrop == null) return null;
  const km = (legPickup ?? 0) + (legDrop ?? 0);
  const min =
    scooterTravelMin(km) + (legPickup != null ? PICKUP_HANDLING_MIN : 0);
  return { km, min };
}
