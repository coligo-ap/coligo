"use server";

import {
  listMerchantPromotions,
  type PublicPromotion,
} from "@/lib/data/customer-catalog";

/**
 * Promotions ACTIVES d'un commerçant pour le panier (réduction produit, offre
 * quantité, code promo). Le panier applique le MÊME moteur (computeCart) que le
 * checkout → mêmes prix partout. RLS : lecture publique des promos actives.
 */
export async function getCartPromotions(
  merchantId: string
): Promise<PublicPromotion[]> {
  if (!merchantId) return [];
  return listMerchantPromotions(merchantId);
}
