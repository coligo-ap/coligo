/**
 * Commandes PROGRAMMÉES (à préparer plus tard).
 *
 * Une commande est « programmée » quand elle a un créneau futur
 * (`pickup_type='slot'` + `pickup_slot_at` à venir). Elle est confirmée à la
 * création (le client a sa garantie) mais NE DOIT PAS être préparée tout de
 * suite : elle n'entre dans la file active qu'à la « fire time » =
 * `pickup_slot_at − prep_time_min`.
 *
 * Modèle SERVERLESS-SAFE par construction : aucune minuterie en mémoire, aucun
 * tick. La bascule « à venir → active » est DÉRIVÉE à chaque lecture du board
 * (on compare `now()` à `fire_at`) → dès que l'heure passe, la commande
 * apparaît dans la file active au rafraîchissement suivant (Realtime/poll).
 */

const MIN = 60_000;

type SchedulableOrder = {
  pickup_type?: string | null;
  pickup_slot_at?: string | null;
  status?: string | null;
};

/**
 * Heure à laquelle la commande doit ENTRER en préparation, ou null si elle est
 * immédiate (asap / pas de créneau). `prepTimeMin` = délai de préparation du
 * commerce (merchants.prep_time_min).
 */
export function scheduledFireAt(
  order: SchedulableOrder,
  prepTimeMin: number
): Date | null {
  if (order.pickup_type !== "slot" || !order.pickup_slot_at) return null;
  const slot = new Date(order.pickup_slot_at).getTime();
  if (Number.isNaN(slot)) return null;
  return new Date(slot - Math.max(0, prepTimeMin) * MIN);
}

/**
 * La commande est-elle encore à VENIR (ne pas préparer maintenant) ?
 * true tant que la fire time n'est pas atteinte.
 */
export function isUpcoming(
  order: SchedulableOrder,
  prepTimeMin: number,
  now: Date = new Date()
): boolean {
  const fire = scheduledFireAt(order, prepTimeMin);
  return fire != null && fire.getTime() > now.getTime();
}

/**
 * La commande est-elle PROGRAMMÉE (créneau futur) au sens « bandeau ticket /
 * badge » ? Plus large que `isUpcoming` : reste vrai jusqu'à l'heure du créneau
 * (pour la traçabilité, même si la préparation a déjà commencé).
 */
export function isScheduled(
  order: SchedulableOrder,
  now: Date = new Date()
): boolean {
  if (order.pickup_type !== "slot" || !order.pickup_slot_at) return false;
  const slot = new Date(order.pickup_slot_at).getTime();
  return !Number.isNaN(slot) && slot > now.getTime();
}
