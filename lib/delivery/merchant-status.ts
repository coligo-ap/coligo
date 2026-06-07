/**
 * Phase de livraison déduite des horodatages — vue COMMERÇANT.
 *
 * Problème résolu : tant que le livreur n'a pas validé, la commande reste au
 * statut `ready` (« Prête »). Côté commerçant c'est perturbant de voir « Prête »
 * alors que le livreur est déjà en route / a récupéré / a livré. On dérive donc
 * une phase lisible à partir des seuls horodatages déjà posés par le livreur
 * (aucune nouvelle colonne d'état, donc zéro risque d'incohérence) :
 *
 *   driver_id NULL                    → en attente d'un livreur
 *   driver_id, pas picked_up          → livreur en route (récupération)
 *   picked_up, pas arrived            → récupérée, en livraison
 *   arrived, pas delivered            → livreur arrivé chez le client
 *   delivered / status=completed      → livrée
 *
 * Robuste / anti-erreur : on lit les champs de façon défensive (undefined/null
 * tolérés) et on retombe toujours sur une phase valide. Pour une commande qui
 * n'est PAS une livraison, on renvoie `null` (le commerçant garde ses statuts
 * de retrait habituels).
 */

export type DeliveryPhaseKey =
  | "awaiting_driver"
  | "driver_enroute"
  | "picked_up"
  | "arrived"
  | "delivered";

export type DeliveryPhaseTone =
  | "neutral"
  | "amber"
  | "primary"
  | "violet"
  | "success";

export type DeliveryPhase = {
  key: DeliveryPhaseKey;
  /** Libellé complet (détail / carte). */
  label: string;
  /** Libellé court (chip kanban). */
  short: string;
  tone: DeliveryPhaseTone;
};

type DeliveryFields = {
  fulfillment_type?: string | null;
  status?: string | null;
  delivery_driver_id?: string | null;
  delivery_picked_up_at?: string | null;
  delivery_arrived_at?: string | null;
  delivery_delivered_at?: string | null;
};

/**
 * Renvoie la phase de livraison d'une commande, ou `null` si ce n'est pas une
 * livraison. Ne lève jamais (entrées partielles tolérées).
 */
export function deliveryPhase(
  o: DeliveryFields | null | undefined
): DeliveryPhase | null {
  if (!o || o.fulfillment_type !== "delivery") return null;

  if (o.delivery_delivered_at || o.status === "completed") {
    return {
      key: "delivered",
      label: "Livrée au client",
      short: "Livrée",
      tone: "success",
    };
  }
  if (o.delivery_arrived_at) {
    return {
      key: "arrived",
      label: "Livreur arrivé chez le client",
      short: "Livreur arrivé",
      tone: "violet",
    };
  }
  if (o.delivery_picked_up_at) {
    return {
      key: "picked_up",
      label: "Récupérée — en cours de livraison",
      short: "En livraison",
      tone: "primary",
    };
  }
  if (o.delivery_driver_id) {
    return {
      key: "driver_enroute",
      label: "Livreur en route pour récupérer",
      short: "Livreur en route",
      tone: "amber",
    };
  }
  return {
    key: "awaiting_driver",
    label: "En attente d'un livreur",
    short: "Attente livreur",
    tone: "neutral",
  };
}
