// =============================================================================
// Moteur de calcul des promotions — fonctions PURES (aucun accès DB).
// =============================================================================
// Réutilisable des deux côtés : ici (commerçant, aperçu) et plus tard au
// checkout client. Mêmes règles partout = mêmes prix partout.
//
// Règles figées (cf. PARTIE A) :
//   - le commerçant absorbe la réduction ;
//   - la commission Coligo se calcule sur le montant PAYÉ (après réduction) ;
//   - un prix après réduction ne peut JAMAIS être <= 0 → plancher `minPriceDa` ;
//   - une seule promo « prix » (product_discount) par produit : la PLUS
//     avantageuse pour le client ;
//   - un seul code promo par commande ; il s'applique sur le total APRÈS les
//     réductions produit ;
//   - une offre quantité ne s'applique que si la quantité atteint le seuil.
//
// Tous les montants sont en DA entiers (arrondis au DA le plus proche).
// =============================================================================

import type { DiscountKind, PromotionStatus, PromotionType } from "@/lib/types";

/** Une ligne de panier en entrée du moteur. */
export type CartLine = {
  productId: string;
  quantity: number;
  /** Prix unitaire normal (catalogue), en DA. */
  unitPriceDa: number;
};

/**
 * Promotion « aplatie » pour le moteur (indépendante de la forme DB).
 * `productIds` liste les produits concernés (product_discount / quantity_offer).
 */
export type EnginePromotion = {
  id: string;
  type: PromotionType;
  status: PromotionStatus;
  discountKind?: DiscountKind | null;
  discountValue?: number | null;
  code?: string | null;
  buyQty?: number | null;
  getQty?: number | null;
  productIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
};

export type EngineOptions = {
  /** Plancher : un prix unitaire après réduction ne descend jamais sous ça. */
  minPriceDa: number;
  /** Taux de commission Coligo (ex. 0.05). */
  commissionRate: number;
  /** Code promo saisi par le client (insensible à la casse). */
  promoCode?: string | null;
  /** Horodatage de référence (par défaut: maintenant). */
  now?: Date;
};

export type ComputedLine = {
  productId: string;
  quantity: number;
  unitPriceDa: number;
  /** Prix unitaire effectivement facturé (après meilleure réduction produit). */
  appliedUnitPriceDa: number;
  /** Unités offertes par une offre quantité (facturées 0). */
  freeUnits: number;
  /** Unités réellement payées = quantity - freeUnits. */
  paidQuantity: number;
  /** Total de la ligne = appliedUnitPriceDa * paidQuantity. */
  lineTotalDa: number;
  /** Promo « prix » retenue sur cette ligne, le cas échéant. */
  productPromotionId?: string;
  /** Offre quantité retenue sur cette ligne, le cas échéant. */
  quantityPromotionId?: string;
};

export type AppliedPromoCode = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  /** Montant retiré du sous-total par le code, en DA. */
  discountDa: number;
};

export type CartComputation = {
  lines: ComputedLine[];
  /** Somme des lignes APRÈS réductions produit / offres quantité. */
  subtotalDa: number;
  /** Code promo appliqué (un seul), si valide. */
  promoCode: AppliedPromoCode | null;
  /** Total final payé par le client (après code promo), capé au plancher. */
  totalDa: number;
  /** Commission Coligo, calculée sur le total PAYÉ. */
  commissionDa: number;
  /** Ce que perçoit le commerçant = total - commission. */
  payoutDa: number;
  /** Total au prix normal (sans aucune promo). */
  normalTotalDa: number;
  /** Économie totale offerte au client = normalTotalDa - totalDa. */
  savingsDa: number;
};

const round = (n: number) => Math.round(n);

/**
 * Statut EFFECTIF d'une promo à un instant donné, dérivé des dates.
 * `disabled` (intention du commerçant) prime ; sinon on calcule depuis
 * starts_at / ends_at. Évite tout cron : la vérité se recalcule à la lecture.
 */
export function effectivePromotionStatus(
  promo: {
    status: PromotionStatus;
    startsAt?: string | null;
    endsAt?: string | null;
  },
  now: Date = new Date()
): PromotionStatus {
  if (promo.status === "disabled") return "disabled";
  const t = now.getTime();
  if (promo.startsAt && new Date(promo.startsAt).getTime() > t) {
    return "scheduled";
  }
  if (promo.endsAt && new Date(promo.endsAt).getTime() < t) {
    return "expired";
  }
  return "active";
}

/** Une promo s'applique-t-elle MAINTENANT ? (seules les `active`). */
export function isPromotionActive(
  promo: Pick<EnginePromotion, "status" | "startsAt" | "endsAt">,
  now: Date = new Date()
): boolean {
  return effectivePromotionStatus(promo, now) === "active";
}

/**
 * Prix unitaire après une réduction, capé au plancher.
 * `percent` : -value % ; `amount` : -value DA.
 */
export function discountedUnitPrice(
  unitPriceDa: number,
  kind: DiscountKind,
  value: number,
  minPriceDa: number
): number {
  const reduced =
    kind === "percent" ? unitPriceDa * (1 - value / 100) : unitPriceDa - value;
  // Jamais <= 0 : on cape au plancher (mais jamais au-dessus du prix normal).
  return Math.min(unitPriceDa, Math.max(minPriceDa, round(reduced)));
}

/**
 * Nombre d'unités offertes pour une offre quantité « buy = get offert ».
 * Ex. buy 2 / get 1 : tous les 3 articles, 1 est offert.
 */
export function freeUnitsForOffer(
  quantity: number,
  buyQty: number,
  getQty: number
): number {
  if (buyQty <= 0 || getQty <= 0) return 0;
  const groupSize = buyQty + getQty;
  if (quantity < groupSize) return 0; // seuil non atteint
  return Math.floor(quantity / groupSize) * getQty;
}

/**
 * Calcule le détail d'un panier face à une liste de promotions.
 * Fonction pure : mêmes entrées → mêmes sorties.
 */
export function computeCart(
  lines: CartLine[],
  promotions: EnginePromotion[],
  options: EngineOptions
): CartComputation {
  const now = options.now ?? new Date();
  const min = options.minPriceDa;

  // Seules les promos actives comptent.
  const activePromos = promotions.filter((p) => isPromotionActive(p, now));

  const productDiscounts = activePromos.filter(
    (p) => p.type === "product_discount"
  );
  const quantityOffers = activePromos.filter(
    (p) => p.type === "quantity_offer"
  );
  const promoCodes = activePromos.filter((p) => p.type === "promo_code");

  const computedLines: ComputedLine[] = lines.map((line) => {
    // 1) Meilleure réduction produit (prix unitaire le plus bas).
    let appliedUnitPriceDa = line.unitPriceDa;
    let productPromotionId: string | undefined;
    for (const promo of productDiscounts) {
      if (!promo.productIds?.includes(line.productId)) continue;
      if (!promo.discountKind || promo.discountValue == null) continue;
      const candidate = discountedUnitPrice(
        line.unitPriceDa,
        promo.discountKind,
        promo.discountValue,
        min
      );
      if (candidate < appliedUnitPriceDa) {
        appliedUnitPriceDa = candidate;
        productPromotionId = promo.id;
      }
    }

    // 2) Meilleure offre quantité (le plus d'unités offertes).
    let freeUnits = 0;
    let quantityPromotionId: string | undefined;
    for (const promo of quantityOffers) {
      if (!promo.productIds?.includes(line.productId)) continue;
      if (!promo.buyQty || !promo.getQty) continue;
      const free = freeUnitsForOffer(line.quantity, promo.buyQty, promo.getQty);
      if (free > freeUnits) {
        freeUnits = free;
        quantityPromotionId = promo.id;
      }
    }

    const paidQuantity = line.quantity - freeUnits;
    const lineTotalDa = round(appliedUnitPriceDa * paidQuantity);

    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceDa: line.unitPriceDa,
      appliedUnitPriceDa,
      freeUnits,
      paidQuantity,
      lineTotalDa,
      productPromotionId,
      quantityPromotionId,
    };
  });

  const subtotalDa = computedLines.reduce((s, l) => s + l.lineTotalDa, 0);

  // 3) Un seul code promo, sur le total APRÈS réductions produit.
  let promoCode: AppliedPromoCode | null = null;
  const wanted = options.promoCode?.trim().toUpperCase();
  if (wanted) {
    const match = promoCodes.find(
      (p) => (p.code ?? "").trim().toUpperCase() === wanted
    );
    if (match && match.discountKind && match.discountValue != null) {
      const raw =
        match.discountKind === "percent"
          ? subtotalDa * (match.discountValue / 100)
          : match.discountValue;
      // Le code ne peut pas retirer plus que le sous-total.
      const discountDa = Math.min(subtotalDa, Math.max(0, round(raw)));
      promoCode = {
        id: match.id,
        code: match.code ?? wanted,
        kind: match.discountKind,
        value: match.discountValue,
        discountDa,
      };
    }
  }

  // 4) Total final, capé au plancher (jamais <= 0 s'il y a quelque chose à payer).
  const afterCode = subtotalDa - (promoCode?.discountDa ?? 0);
  const totalDa = subtotalDa === 0 ? 0 : Math.max(min, afterCode);

  const commissionDa = round(totalDa * options.commissionRate);
  const payoutDa = totalDa - commissionDa;

  const normalTotalDa = lines.reduce(
    (s, l) => s + round(l.unitPriceDa * l.quantity),
    0
  );
  const savingsDa = Math.max(0, normalTotalDa - totalDa);

  return {
    lines: computedLines,
    subtotalDa,
    promoCode,
    totalDa,
    commissionDa,
    payoutDa,
    normalTotalDa,
    savingsDa,
  };
}
