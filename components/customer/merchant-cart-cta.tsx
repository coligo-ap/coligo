"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PartyPopper, ShoppingBag, ShoppingBasket, Truck } from "lucide-react";
import {
  rawSubtotal,
  setActiveMerchant,
  totalUnits,
  useCartFor,
} from "@/lib/customer/cart-store";
import { computeCart, isPromotionActive } from "@/lib/promotions/engine";
import {
  summarizeCartPromotions,
  toEnginePromotions,
} from "@/lib/promotions/cart-summary";
import { APP_CONFIG } from "@/lib/config/app-config";
import { getCartPromotions } from "@/app/(customer)/cart/actions";
import type { PublicPromotion } from "@/lib/data/customer-catalog";
import { cn, formatDA } from "@/lib/utils";

// =============================================================================
// MerchantCartCta — barre sticky en bas de la fiche commerçant.
// =============================================================================
// Bouton principal (compteur · « Voir mon panier » · total) + UNE seule bande
// contextuelle au-dessus (jamais d'empilement — l'info la plus UTILE gagne) :
//   1. panier < minimum de commande  → progression vers le minimum (prioritaire,
//      c'est bloquant pour commander) ;
//   2. des promos s'appliquent       → économie réalisée (incite à finaliser) ;
//   3. livraison offerte proche      → « plus que X » (nudge, tournée).
// Petit rebond + flash sur le compteur à chaque ajout (pas de toast intrusif).
// =============================================================================

export function MerchantCartCta({
  merchantId,
  minOrderDa = 0,
}: {
  merchantId: string;
  /** Minimum de commande du commerçant (DA) — 0 = aucun. */
  minOrderDa?: number;
}) {
  const t = useTranslations("merchant");
  const tc = useTranslations("cart");
  const cart = useCartFor(merchantId);
  const count = totalUnits(cart);
  const raw = rawSubtotal(cart);

  // Promotions actives du commerçant — mêmes que le panier (même moteur).
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  useEffect(() => {
    let alive = true;
    if (!merchantId) return;
    void getCartPromotions(merchantId).then((p) => {
      if (alive) setPromotions(p);
    });
    return () => {
      alive = false;
    };
  }, [merchantId]);

  const { subtotal, savings, promoCount, freeDeliveryMin } = useMemo(() => {
    const settled = computeCart(
      cart.items.map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        unitPriceDa: i.unit_price_da,
      })),
      toEnginePromotions(promotions),
      {
        minPriceDa: APP_CONFIG.promotions.minPriceDa,
        commissionRate: APP_CONFIG.commission.rate,
      }
    );
    const sum = summarizeCartPromotions(promotions, settled);
    // Livraison offerte (tournée) : le seuil le plus bas parmi les offres actives.
    const fdMins = promotions
      .filter(
        (p) =>
          p.type === "free_delivery" &&
          isPromotionActive({
            status: p.status,
            startsAt: p.starts_at,
            endsAt: p.ends_at,
          })
      )
      .map((p) => p.min_subtotal_da ?? 0);
    return {
      subtotal: settled.subtotalDa,
      savings: Math.max(0, settled.normalTotalDa - settled.subtotalDa),
      promoCount: sum.count,
      freeDeliveryMin: fdMins.length > 0 ? Math.min(...fdMins) : null,
    };
  }, [cart.items, promotions]);

  // Déclenche une animation à chaque changement de quantité (sauf au mount).
  const [pulse, setPulse] = useState(false);
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 450);
      prevCount.current = count;
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count]);

  if (count === 0) return null;

  const hasSavings = savings > 0;
  const belowMin = minOrderDa > 0 && subtotal < minOrderDa;
  // Nudge livraison offerte : seuil pas encore atteint, mais À PORTÉE (< 2×).
  const fdRemaining =
    freeDeliveryMin != null && subtotal < freeDeliveryMin
      ? freeDeliveryMin - subtotal
      : null;
  const showFdNudge =
    !belowMin &&
    !hasSavings &&
    fdRemaining != null &&
    freeDeliveryMin != null &&
    subtotal >= freeDeliveryMin / 2;

  // Sous-ligne contextuelle DANS la pilule (une seule, priorité stricte) —
  // pousse à compléter le panier sans empiler de bandeaux au-dessus. Les
  // ÉCONOMIES ont leur propre carte sombre au-dessus (autre couleur → lisible).
  const subline = belowMin
    ? {
        Icon: ShoppingBasket,
        text: t("ctaMinRemaining", { amount: formatDA(minOrderDa - subtotal) }),
      }
    : showFdNudge
      ? {
          Icon: Truck,
          text: t("ctaFreeDeliveryRemaining", {
            amount: formatDA(fdRemaining!),
          }),
        }
      : null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-md">
        {/* UNE pilule compacte, style iOS : total + compteur + sous-ligne
            contextuelle intégrée + progression vers le minimum en filet bas. */}
        <Link
          href="/cart"
          onClick={() => setActiveMerchant(merchantId)}
          className={cn(
            "bg-primary-600 hover:bg-primary-700 relative block overflow-hidden rounded-[10px] text-white shadow-[0_20px_42px_-12px_rgba(108,43,217,0.55)] transition-transform",
            // Bloc SOUDÉ à la carte économies dessous : coins bas à plat.
            hasSavings && !belowMin && "rounded-b-none",
            pulse && "scale-[1.02]"
          )}
        >
          {/* Reflet "shine" léger sur le haut de la pilule. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent"
          />

          <span
            className={cn(
              "relative flex items-center gap-3 ps-2.5 pe-3 pt-2.5",
              subline ? "pb-1" : "pb-2.5"
            )}
          >
            <span
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-[11px] bg-white/15 px-2.5 text-[14px] font-extrabold tabular-nums transition-transform",
                pulse && "bg-coral-500 scale-110"
              )}
            >
              <ShoppingBag className="size-4" />
              {count}
            </span>
            <span className="min-w-0 flex-1 truncate text-center text-[15px] font-extrabold">
              {t("viewMyCart")}
            </span>
            <span className="flex shrink-0 flex-col items-end leading-none">
              {hasSavings && (
                <span className="text-[11px] font-semibold text-white/70 tabular-nums line-through">
                  {formatDA(raw)}
                </span>
              )}
              <span className="text-base font-black tracking-tight tabular-nums">
                {formatDA(subtotal)}
              </span>
            </span>
          </span>

          {/* Sous-ligne contextuelle (min / économies / livraison offerte). */}
          {subline && (
            <span className="relative flex items-center justify-center gap-1.5 px-3 pb-2 text-[11.5px] font-bold text-white/90">
              <subline.Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{subline.text}</span>
            </span>
          )}

          {/* Progression vers le minimum de commande — filet bas de la pilule. */}
          {belowMin && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20"
            >
              <span
                className="block h-full rounded-e-full bg-white transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, Math.round((subtotal / minOrderDa) * 100))}%`,
                }}
              />
            </span>
          )}
        </Link>

        {/* Économies — carte SOMBRE « verre » premium (charbon, texte inversé
            via tokens → s'adapte seule au mode sombre), montant en pastille.
            SOUDÉE à la pilule (zéro espace, coins joints à plat) : le bouton
            et la carte forment UN bloc. Couleurs inchangées. */}
        {hasSavings && !belowMin && (
          <div className="cg-promo-rise bg-foreground/95 text-surface flex items-center gap-2.5 rounded-b-[10px] px-3.5 py-2 shadow-[0_14px_34px_-14px_rgba(10,10,20,0.65)] backdrop-blur-md">
            <span className="bg-surface/20 grid size-6 shrink-0 place-items-center rounded-full">
              <PartyPopper className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">
              {tc("promosApplied", { count: promoCount })}
            </span>
            {/* Montant du gain en VERT franc (pastille pleine) — impossible à
                rater, lisible sur charbon comme sur la variante claire. */}
            <span className="bg-success-600 shrink-0 rounded-full px-2.5 py-1 text-[12px] font-black text-white tabular-nums">
              −{formatDA(savings)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
