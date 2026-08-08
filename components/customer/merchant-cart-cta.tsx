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
  // Une languette (CtaTab) est-elle affichée sous la pilule ? → coins bas de
  // la pilule à PLAT (sinon ses arrondis laissent deux encoches transparentes
  // au-dessus de la languette : jonction 100 % pleine, effet soudé pro).
  const hasTab = subline !== null || (hasSavings && !belowMin);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-30 px-4 pb-1.5 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-md">
        {/* UNE pilule compacte, style iOS : total + compteur + sous-ligne
            contextuelle intégrée + progression vers le minimum en filet bas. */}
        <Link
          href="/cart"
          onClick={() => setActiveMerchant(merchantId)}
          className={cn(
            "bg-primary-600 hover:bg-primary-700 rounded-control relative block overflow-hidden text-white shadow-[0_20px_42px_-12px_rgba(108,43,217,0.55)] transition-transform",
            hasTab && "rounded-b-none",
            pulse && "scale-[1.02]"
          )}
        >
          {/* Reflet "shine" léger sur le haut de la pilule. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent"
          />

          <span className="relative flex items-center gap-3 ps-2.5 pe-3 pt-2.5 pb-2.5">
            <span
              className={cn(
                "rounded-control-lg text-body-lg inline-flex h-9 items-center gap-1.5 bg-white/15 px-2.5 font-extrabold tabular-nums transition-transform",
                pulse && "bg-coral-500 scale-110"
              )}
            >
              <ShoppingBag className="size-4" />
              {count}
            </span>
            <span className="text-title-sm min-w-0 flex-1 truncate text-center font-extrabold">
              {t("viewMyCart")}
            </span>
            <span className="flex shrink-0 flex-col items-end leading-none">
              {hasSavings && (
                <span className="text-caption font-semibold text-white/70 tabular-nums line-through">
                  {formatDA(raw)}
                </span>
              )}
              <span className="text-base font-black tracking-tight tabular-nums">
                {formatDA(subtotal)}
              </span>
            </span>
          </span>
        </Link>

        {/* Sous-ligne contextuelle (minimum / livraison offerte) — même
            languette (CtaTab) que la carte économies (jamais les deux à la
            fois : priorités mutuellement exclusives), avec la progression
            vers le minimum en filet VERT à sa base. */}
        {subline && (
          <CtaTab className="justify-center pb-2">
            <span className="text-caption-lg flex min-w-0 items-center gap-1.5 font-bold">
              <subline.Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{subline.text}</span>
            </span>
            {belowMin && (
              <span
                aria-hidden
                className="bg-surface/20 absolute inset-x-0 bottom-0 h-[3px]"
              >
                <span
                  className="bg-success-500 block h-full rounded-e-full transition-[width] duration-300"
                  style={{
                    width: `${Math.min(100, Math.round((subtotal / minOrderDa) * 100))}%`,
                  }}
                />
              </span>
            )}
          </CtaTab>
        )}

        {/* Économies — même languette, montant en pastille verte. */}
        {hasSavings && !belowMin && (
          <CtaTab>
            <span className="bg-surface/20 grid size-5 shrink-0 place-items-center rounded-full">
              <PartyPopper className="size-3" />
            </span>
            <span className="text-label-lg min-w-0 flex-1 truncate font-bold">
              {tc("promosApplied", { count: promoCount })}
            </span>
            {/* Montant du gain en VERT franc (pastille pleine) — impossible à
                rater, lisible sur charbon comme sur la variante claire. */}
            <span className="bg-success-600 text-label shrink-0 rounded-full px-2.5 py-0.5 font-black text-white tabular-nums">
              −{formatDA(savings)}
            </span>
          </CtaTab>
        )}
      </div>
    </div>
  );
}

/**
 * Languette charbon commune sous la pilule « Voir mon panier » : PLEINE
 * largeur (celle du bouton), fine (py-1.5) et courbée en bas (16 px) —
 * « verre » premium qui s'inverse seul en mode sombre via les tokens.
 */
function CtaTab({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cg-promo-rise bg-foreground/95 text-surface relative flex items-center gap-2.5 overflow-hidden rounded-b-lg px-3.5 py-1.5 shadow-[0_14px_34px_-14px_rgba(10,10,20,0.65)] backdrop-blur-md",
        className
      )}
    >
      {children}
    </div>
  );
}
