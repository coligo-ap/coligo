// =============================================================================
// Synthèse des promotions APPLIQUÉES à un panier — fonctions PURES.
// =============================================================================
// Dérive, à partir de la sortie du moteur (`computeCart`) et de la liste des
// promotions publiques, le détail « ce que le client économise et grâce à quoi »
// pour l'afficher de façon premium (bloc panier + badge « Voir mon panier »).
//
// Mêmes entrées → mêmes sorties. Aucun accès DB. Réutilisé par le panier et la
// barre sticky de la fiche commerçant → un seul calcul, mêmes chiffres partout.
// =============================================================================

import type { PublicPromotion } from "@/lib/data/customer-catalog";
import type { CartComputation, EnginePromotion } from "./engine";

/** Aplatit une promotion publique (forme DB) vers la forme attendue du moteur. */
export function toEnginePromotions(
  promotions: PublicPromotion[]
): EnginePromotion[] {
  return promotions.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    discountKind: p.discount_kind,
    discountValue: p.discount_value,
    code: p.code,
    buyQty: p.buy_qty,
    getQty: p.get_qty,
    minSubtotalDa: p.min_subtotal_da,
    productIds: p.product_ids,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
  }));
}

/** Une promotion réellement appliquée au panier, avec son économie. */
export type AppliedPromoSummary = {
  id: string;
  /** Seules les promos appliquées dès le panier (le code promo, lui, s'applique
   *  à l'étape paiement → traité à part comme « teaser »). */
  type: "product_discount" | "quantity_offer";
  titleFr: string;
  titleAr: string | null;
  /** Montant économisé en DA grâce à cette promo (toujours > 0). */
  savingsDa: number;
  /** Offre quantité : nombre total d'unités offertes (sinon 0). */
  freeUnits: number;
};

export type CartPromoSummary = {
  /** Promos appliquées (réduction produit + offre quantité), triées par gain. */
  applied: AppliedPromoSummary[];
  /** Nombre de promos appliquées. */
  count: number;
  /** Économie totale (DA) = somme des promos appliquées (== savings du moteur). */
  totalSavingsDa: number;
};

/**
 * Synthétise les promotions appliquées à un panier déjà calculé.
 *
 * Décomposition de l'économie, par ligne, qui se somme EXACTEMENT à
 * `normalTotal - subtotal` (cf. moteur) :
 *   - réduction produit  : (prix normal − prix appliqué) × quantité ;
 *   - offre quantité     : prix appliqué × unités offertes.
 */
export function summarizeCartPromotions(
  promotions: PublicPromotion[],
  computation: CartComputation
): CartPromoSummary {
  const byId = new Map(promotions.map((p) => [p.id, p]));

  // Économie + unités offertes cumulées par promotion.
  const acc = new Map<string, { savings: number; freeUnits: number }>();
  const bump = (id: string, savings: number, freeUnits = 0) => {
    const prev = acc.get(id) ?? { savings: 0, freeUnits: 0 };
    acc.set(id, {
      savings: prev.savings + savings,
      freeUnits: prev.freeUnits + freeUnits,
    });
  };

  for (const line of computation.lines) {
    if (line.productPromotionId && line.appliedUnitPriceDa < line.unitPriceDa) {
      bump(
        line.productPromotionId,
        (line.unitPriceDa - line.appliedUnitPriceDa) * line.quantity
      );
    }
    if (line.quantityPromotionId && line.freeUnits > 0) {
      bump(
        line.quantityPromotionId,
        line.appliedUnitPriceDa * line.freeUnits,
        line.freeUnits
      );
    }
  }

  const applied: AppliedPromoSummary[] = [];
  for (const [id, { savings, freeUnits }] of acc) {
    const promo = byId.get(id);
    if (!promo || savings <= 0) continue;
    applied.push({
      id,
      type:
        promo.type === "quantity_offer" ? "quantity_offer" : "product_discount",
      titleFr: promo.title_fr,
      titleAr: promo.title_ar,
      savingsDa: Math.round(savings),
      freeUnits,
    });
  }

  // Le plus gros gain en premier (hiérarchie visuelle).
  applied.sort((a, b) => b.savingsDa - a.savingsDa);

  return {
    applied,
    count: applied.length,
    totalSavingsDa: applied.reduce((s, p) => s + p.savingsDa, 0),
  };
}
