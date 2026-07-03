"use client";

import { BadgePercent, Gift } from "lucide-react";
import { ProductCarousel } from "@/components/customer/popular-carousel";
import type {
  PublicProduct,
  PublicPromotion,
} from "@/lib/data/customer-catalog";

type Merchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};

/**
 * Carrousels promo en tête du catalogue (style « Populaires ») : un carrousel
 * horizontal par promotion à produits. L'ordre est décidé par l'appelant
 * (offres quantité d'abord, puis réductions produit). Les codes promo n'ont
 * pas de produits → ils sont affichés ailleurs (carte dédiée).
 */
export function PromoCarousels({
  merchant,
  promotions,
  products,
  promoPriceById,
  quantityOfferByProduct,
  onOpenDetail,
}: {
  merchant: Merchant;
  promotions: PublicPromotion[];
  products: PublicProduct[];
  promoPriceById: Record<string, number>;
  quantityOfferByProduct: Record<string, { buy: number; get: number }>;
  onOpenDetail: (p: PublicProduct) => void;
}) {
  const byId = new Map(products.map((p) => [p.id, p]));

  const sections = promotions
    .map((promo) => {
      const items = promo.product_ids
        .map((id) => byId.get(id))
        .filter((p): p is PublicProduct => !!p)
        .filter(
          (p) =>
            p.is_available !== false && (p.stock_qty == null || p.stock_qty > 0)
        );
      return { promo, items };
    })
    .filter((s) => s.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <>
      {/* Réutilise le carrousel générique (markup unique + pliage inclus). */}
      {sections.map(({ promo, items }) => {
        const Icon = promo.type === "quantity_offer" ? Gift : BadgePercent;
        return (
          <ProductCarousel
            key={promo.id}
            title={promo.title_fr}
            icon={<Icon className="text-accent-600 size-5" />}
            merchant={merchant}
            products={items}
            promoPriceById={promoPriceById}
            quantityOfferByProduct={quantityOfferByProduct}
            onOpenDetail={onOpenDetail}
          />
        );
      })}
    </>
  );
}
