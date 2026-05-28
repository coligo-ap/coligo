import type { OrderStatus } from "@/lib/types";

/**
 * Estimation du temps de livraison côté CLIENT, façon UberEats/Yassir :
 * on additionne (1) la préparation restante chez le commerçant, (2) le temps
 * que le livreur met à venir CHERCHER la commande, (3) le trajet commerçant →
 * client. L'estimation s'affine par phase (préparation → en route).
 */

// Vitesse urbaine moyenne (km/h) pour convertir une distance en minutes.
export const AVG_SPEED_KMH = 18;
// Forfait « le livreur va chercher la commande » avant le pickup (on ne
// connaît pas encore sa position avec certitude à ce stade).
const DRIVER_PICKUP_BUFFER_MIN = 6;

function travelMin(distanceKm: number | null): number {
  if (distanceKm == null || distanceKm <= 0) return 0;
  return Math.ceil((distanceKm / AVG_SPEED_KMH) * 60);
}

/**
 * Renvoie l'ETA en minutes, ou null si la commande est terminée/annulée ou
 * qu'on n'a pas assez d'infos.
 */
export function estimateDeliveryEtaMin(opts: {
  status: OrderStatus;
  pickedUpAt: string | null;
  createdAt: string;
  /** Temps de préparation du commerçant (min). */
  prepMinutes: number;
  /** Distance commerçant → client (km), stockée à la création de la commande. */
  distanceKm: number | null;
}): number | null {
  const { status, pickedUpAt, createdAt, prepMinutes, distanceKm } = opts;
  if (status === "completed" || status === "cancelled") return null;

  const trajet = Math.max(1, travelMin(distanceKm));

  // En transit (récupérée) : il ne reste que le trajet jusqu'au client. La
  // carte live affine avec la position réelle du livreur.
  if (pickedUpAt) return trajet;

  // Prête, en attente du livreur : il vient chercher puis livre.
  if (status === "ready") return DRIVER_PICKUP_BUFFER_MIN + trajet;

  // En préparation : préparation restante + pickup + trajet.
  const elapsedMin = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 60_000
  );
  const prepRemaining = Math.max(0, prepMinutes - elapsedMin);
  return prepRemaining + DRIVER_PICKUP_BUFFER_MIN + trajet;
}

/** Format « ~X min » ou une fourchette « ~X–Y min » (± marge). */
export function formatEta(min: number): string {
  if (min <= 1) return "moins de 5 min";
  const low = Math.max(5, Math.round(min / 5) * 5 - 5);
  const high = Math.round(min / 5) * 5 + 5;
  return `${low}–${high} min`;
}
