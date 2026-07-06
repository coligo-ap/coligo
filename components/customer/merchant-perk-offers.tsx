"use client";

import { useLocale, useTranslations } from "next-intl";
import { Gift, Truck } from "lucide-react";
import { formatDA } from "@/lib/utils";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

// =============================================================================
// MerchantPerkOffers — avantages « perk » de la boutique : CADEAU offert et
// LIVRAISON offerte (mig 0331). Ces offres n'ont ni produit ni code : le
// commerçant les honore selon ses conditions. Carte attractive (rose accent),
// avec la condition résumée (panier minimum, expiration).
// =============================================================================

export function MerchantPerkOffers({
  promotions,
}: {
  promotions: PublicPromotion[];
}) {
  const perks = promotions.filter(
    (p) => p.type === "free_gift" || p.type === "free_delivery"
  );
  if (perks.length === 0) return null;
  return (
    <div className="space-y-2">
      {perks.map((p) => (
        <PerkCard key={p.id} promotion={p} />
      ))}
    </div>
  );
}

function PerkCard({ promotion }: { promotion: PublicPromotion }) {
  const t = useTranslations("browse");
  const locale = useLocale();

  const isDelivery = promotion.type === "free_delivery";
  const Icon = isDelivery ? Truck : Gift;
  const value = isDelivery
    ? t("offerFreeDelivery")
    : promotion.gift_label || t("offerGift");

  // Conditions : panier minimum + expiration (comme les codes promo).
  const conditions: string[] = [];
  if (promotion.min_subtotal_da != null) {
    conditions.push(
      t("offerMinBasket", { amount: formatDA(promotion.min_subtotal_da) })
    );
  }
  if (promotion.ends_at) {
    const d = new Date(promotion.ends_at).toLocaleDateString(
      locale === "ar" ? "ar-DZ" : "fr-DZ",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Algiers",
      }
    );
    conditions.push(t("offerExpiresOn", { date: d }));
  }
  const summary =
    conditions.length > 0 ? conditions.join(" · ") : t("offerNoCondition");

  // Une SEULE fois l'offre (le titre libre du commerçant — souvent « Livraison
  // gratuite » — ferait doublon avec la valeur), puis la condition en dessous.
  return (
    <div className="border-accent-300 bg-accent-50 flex items-center gap-3 overflow-hidden rounded-[16px] border border-dashed px-3.5 py-3">
      <span className="bg-accent-600 grid size-11 shrink-0 place-items-center rounded-[12px] text-white shadow-sm">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-accent-700 flex items-baseline gap-1.5 text-sm font-extrabold">
          <span className="truncate">{value}</span>
          {isDelivery && (
            <span className="text-muted shrink-0 text-[11px] font-semibold">
              · {t("offerTourOnly")}
            </span>
          )}
        </span>
        <span className="text-muted mt-0.5 block truncate text-[11px]">
          {summary}
        </span>
      </span>
    </div>
  );
}
