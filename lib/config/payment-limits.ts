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
 * Plancher d'achat ABSOLU plateforme (peu importe la catégorie). En dessous,
 * rentabilité impossible (frais Chargily, hosting, ops). Les commerçants
 * peuvent surcharger PLUS HAUT via `merchants.min_order_da`, jamais plus bas.
 *
 * - Online : 80 DA  (laisse marge au-dessus du min Chargily de 50)
 * - Cash   : 80 DA  (cohérent avec un panier épicerie/boulangerie minimal)
 */
export const MIN_ORDER_ONLINE_DA = 80;
export const MIN_ORDER_CASH_DA = 80;

/**
 * Minimum suggéré PAR CATÉGORIE de commerçant — basé sur les paniers moyens
 * algériens (cf. étude pouvoir d'achat). Utilisé au signup pour pré-remplir
 * `merchants.min_order_da` ; le commerçant peut le monter mais pas le
 * descendre en dessous du plancher absolu ci-dessus.
 *
 * Les catégories non listées tombent sur DEFAULT_MIN_BY_CATEGORY (100).
 */
export const MIN_BY_CATEGORY: Record<string, number> = {
  boulangerie: 80,
  cafe: 100,
  superette: 150,
  fruits_legumes: 100,
  pharmacie: 150,
  fast_food: 300,
  pizzeria: 400,
  restaurant: 500,
  creperie: 250,
  glacier: 200,
  boucherie: 600,
  poissonnerie: 500,
  produits_bio: 300,
  fleuriste: 300,
  // tout ce qui n'est pas alimentaire ↓
  cosmetiques: 300,
  vetements: 500,
  chaussures: 500,
  bijouterie: 500,
  librairie: 200,
  jouets: 300,
  electronique: 500,
  informatique: 1000,
  electromenager: 2000,
  quincaillerie: 200,
  decoration: 300,
  ameublement: 2000,
  sport: 500,
  animalerie: 200,
};
export const DEFAULT_MIN_BY_CATEGORY = 100;

/** Suggestion par catégorie pour le signup commerçant. Plancher absolu garanti. */
export function suggestedMinOrderForCategory(category: string | null): number {
  const suggestion = category ? MIN_BY_CATEGORY[category] : undefined;
  const value = suggestion ?? DEFAULT_MIN_BY_CATEGORY;
  return Math.max(MIN_ORDER_CASH_DA, value);
}

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
