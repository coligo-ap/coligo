// =============================================================================
// GA4 e-commerce — tunnel de conversion (events standards reconnus nativement).
// =============================================================================
// On émet les évènements e-commerce GA4 RECOMMANDÉS, avec les paramètres
// attendus (currency + value + items[]) pour alimenter les rapports
// « Monétisation » et l'entonnoir add_to_cart → begin_checkout → purchase.
//
// Devise : DZD (dinar algérien, ISO 4217). `value` = montant (revenu) en DA.
// Tout est no-op si GA est désactivé (cf. gaEvent). Jamais bloquant.
//
// Réf. schéma : https://developers.google.com/analytics/devguides/collection/ga4/reference/events
// =============================================================================

import { gaEvent } from "./gtag";

/** Devise des transactions (Algérie). */
export const GA_CURRENCY = "DZD";

/** Ligne « panier » générique en entrée (indépendante de la forme interne). */
export type GaLineInput = {
  /** Identifiant stable du produit (product_id si dispo, sinon le nom). */
  id: string;
  name: string;
  unitPriceDa: number;
  quantity: number;
  category?: string | null;
};

type GaItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  item_category?: string;
  item_brand?: string;
};

function toItems(lines: GaLineInput[], merchantName?: string | null): GaItem[] {
  return lines.map((l) => {
    const item: GaItem = {
      item_id: l.id,
      item_name: l.name,
      price: Math.round(l.unitPriceDa),
      quantity: l.quantity,
    };
    if (l.category) item.item_category = l.category;
    if (merchantName) item.item_brand = merchantName;
    return item;
  });
}

/** Ajout d'un produit au panier (depuis la fiche / la liste). */
export function trackAddToCart(
  line: GaLineInput,
  merchantName?: string | null
): void {
  gaEvent("add_to_cart", {
    currency: GA_CURRENCY,
    value: Math.round(line.unitPriceDa * line.quantity),
    items: toItems([line], merchantName),
  });
}

/** Entrée dans le tunnel de paiement (page checkout, panier non vide). */
export function trackBeginCheckout(
  lines: GaLineInput[],
  valueDa: number,
  merchantName?: string | null
): void {
  gaEvent("begin_checkout", {
    currency: GA_CURRENCY,
    value: Math.round(valueDa),
    items: toItems(lines, merchantName),
  });
}

/**
 * Achat confirmé. `transaction_id` = order_id (clé de DÉDUPLICATION : GA ignore
 * un purchase au transaction_id déjà vu → on évite tout double-comptage, mais on
 * sécurise AUSSI côté client, cf. order-purchase-tracking).
 */
export function trackPurchase(input: {
  orderId: string;
  valueDa: number;
  lines: GaLineInput[];
  shippingDa?: number;
  coupon?: string | null;
  merchantName?: string | null;
}): void {
  const params: Record<string, unknown> = {
    transaction_id: input.orderId,
    currency: GA_CURRENCY,
    value: Math.round(input.valueDa),
    items: toItems(input.lines, input.merchantName),
  };
  if (input.shippingDa && input.shippingDa > 0) {
    params.shipping = Math.round(input.shippingDa);
  }
  if (input.coupon) params.coupon = input.coupon;
  gaEvent("purchase", params);
}

/** Remboursement (commande annulée APRÈS avoir été comptée comme achat). */
export function trackRefund(orderId: string, valueDa: number): void {
  gaEvent("refund", {
    transaction_id: orderId,
    currency: GA_CURRENCY,
    value: Math.round(valueDa),
  });
}
