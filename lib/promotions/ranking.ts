// =============================================================================
// Classement intelligent des promotions (côté client, page commerce).
// =============================================================================
// Fonction PURE : ordonne les offres de la PLUS attractive à la moins
// attractive pour le client. Priorité par TYPE (l'urgence d'une vente flash et
// le gros rabais anti-gaspi passent devant), puis départage par la MAGNITUDE du
// rabais (et l'urgence pour le flash). Utilisée pour le carrousel d'offres.
// =============================================================================

import type { PublicPromotion } from "@/lib/data/customer-catalog";

/** Magnitude normalisée du rabais (~0..100) — % direct, ou montant amorti. */
function discountMagnitude(p: PublicPromotion): number {
  const val =
    p.discount_value != null ? Math.round(Number(p.discount_value)) : 0;
  if (p.discount_kind === "percent") return Math.min(100, val);
  if (p.discount_kind === "amount") return Math.min(80, val / 25); // 2000 DA ≈ 80
  return 0;
}

/**
 * Score d'attractivité (plus haut = mis en avant en premier).
 * Vente flash (urgence) ▸ anti-gaspi ▸ offre quantité ▸ livraison ▸ cadeau ▸
 * réduction produit ▸ code. La valeur du rabais départage au sein d'un type.
 */
export function scorePromotion(
  p: PublicPromotion,
  now: Date = new Date()
): number {
  const mag = discountMagnitude(p);
  switch (p.type) {
    case "flash_sale": {
      // Plus la fin approche, plus on booste (rareté temporelle).
      let urgency = 0;
      if (p.ends_at) {
        const h = (new Date(p.ends_at).getTime() - now.getTime()) / 3_600_000;
        if (h <= 2) urgency = 60;
        else if (h <= 6) urgency = 45;
        else if (h <= 24) urgency = 30;
        else if (h <= 72) urgency = 15;
      }
      return 1000 + urgency + mag;
    }
    case "anti_gaspillage":
      return 800 + mag;
    case "quantity_offer": {
      const ratio =
        p.buy_qty && p.get_qty ? p.get_qty / (p.buy_qty + p.get_qty) : 0;
      return 600 + ratio * 100;
    }
    case "free_delivery":
      return 560;
    case "free_gift":
      return 540;
    case "product_discount":
      return 400 + mag;
    case "promo_code":
      return 300 + mag;
    default:
      return 100;
  }
}

/** Trie les promos par attractivité décroissante (stable sur égalité). */
export function rankPromotions<T extends PublicPromotion>(
  promos: T[],
  now: Date = new Date()
): T[] {
  return promos
    .map((p, i) => ({ p, i, s: scorePromotion(p, now) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}
