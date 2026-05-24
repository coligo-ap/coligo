// =============================================================================
// Bornes de paiement plateforme — argent réel, valeurs critiques.
// =============================================================================
// Centralisé ici pour éviter des constantes éparpillées et faciliter l'audit.
// Toutes les valeurs sont en DA ENTIERS (cohérence avec le reste du modèle
// financier — pas de centimes côté Coligo).
// =============================================================================

/**
 * Minimum imposé par Chargily Pay v2 sur un paiement en ligne (réponse API
 * "The amount field must be greater than or equal to 50."). Toute commande
 * online avec un total à payer < 50 DA après cashback/topup sera refusée par
 * Chargily — on l'attrape côté serveur AVANT l'appel pour donner un message
 * clair (sinon on créerait une commande pending qui ne peut jamais être payée).
 */
export const CHARGILY_MIN_AMOUNT_DA = 50;

/**
 * Plancher d'achat recommandé Coligo (MVP). En dessous, peu rentable pour le
 * commerçant ET pour la plateforme (frais Chargily fixes). Les commerçants
 * peuvent surcharger PLUS HAUT via `merchants.min_order_da`, jamais plus bas.
 *
 * - Online : 100 DA (laisse marge confortable au-dessus du min Chargily)
 * - Cash   : 100 DA (rentabilité minimale pour le commerçant)
 */
export const MIN_ORDER_ONLINE_DA = 100;
export const MIN_ORDER_CASH_DA = 100;

/**
 * Minimum d'une recharge Coligo Pay (étape B). 100 DA évite les micro-
 * recharges qui ne servent à rien et coûtent du frais Chargily.
 */
export const MIN_TOPUP_DA = 100;

/**
 * Résolution du minimum applicable à une commande :
 *   - PLANCHER plateforme (MIN_ORDER_*_DA selon le mode)
 *   - SURCHARGE commerçant (merchants.min_order_da) si > plancher
 * Le commerçant ne peut JAMAIS descendre en dessous du plancher Coligo.
 */
export function resolveMinOrderDa(
  paymentMethod: "cash" | "online",
  merchantMinOrderDa: number
): number {
  const platformFloor =
    paymentMethod === "online" ? MIN_ORDER_ONLINE_DA : MIN_ORDER_CASH_DA;
  return Math.max(platformFloor, merchantMinOrderDa);
}
