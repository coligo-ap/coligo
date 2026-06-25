"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PartyPopper, ShoppingBag } from "lucide-react";
import {
  rawSubtotal,
  setActiveMerchant,
  totalUnits,
  useCartFor,
} from "@/lib/customer/cart-store";
import { computeCart } from "@/lib/promotions/engine";
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
// Petit effet rebond + flash sur le compteur à chaque ajout (au lieu d'un
// toast intrusif). Le client perçoit l'ajout sans qu'un overlay ne lui
// bouffe l'écran quand il enchaîne plusieurs produits.
//
// Quand des promotions s'appliquent au panier, un badge dynamique met en avant
// l'économie réalisée (nombre de promos + montant) AVANT même d'ouvrir le
// panier → incite à finaliser. Mêmes chiffres que le panier (même moteur).
// =============================================================================

export function MerchantCartCta({ merchantId }: { merchantId: string }) {
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

  const { subtotal, savings, promoCount } = useMemo(() => {
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
    return {
      subtotal: settled.subtotalDa,
      savings: Math.max(0, settled.normalTotalDa - settled.subtotalDa),
      promoCount: sum.count,
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

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-md space-y-1.5">
        {/* Badge promo dynamique — visible uniquement si une promo s'applique. */}
        {hasSavings && (
          <div className="cg-promo-rise dark:bg-surface/95 flex items-center gap-2 rounded-[14px] border border-rose-200 bg-white/95 px-3 py-1.5 shadow-[0_12px_30px_-14px_rgba(225,29,72,0.5)] backdrop-blur-md dark:border-rose-500/30">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-rose-600 text-white">
              <PartyPopper className="size-[13px]" />
            </span>
            <span className="text-foreground flex-1 truncate text-[12.5px] font-extrabold">
              {tc("promosApplied", { count: promoCount })}
            </span>
            <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[12px] font-black text-rose-600 tabular-nums dark:bg-rose-950/40 dark:text-rose-300">
              −{formatDA(savings)}
            </span>
          </div>
        )}

        <Link
          href="/cart"
          onClick={() => setActiveMerchant(merchantId)}
          className={cn(
            "bg-primary-600 hover:bg-primary-700 relative flex items-center gap-3 overflow-hidden rounded-[18px] py-2.5 ps-2.5 pe-3 text-white shadow-[0_20px_42px_-12px_rgba(108,43,217,0.55)] transition-transform",
            pulse && "scale-[1.02]"
          )}
        >
          {/* Reflet "shine" léger sur le haut de la barre. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent"
          />
          <span
            className={cn(
              "relative inline-flex h-10 items-center gap-2 rounded-[12px] bg-white/15 px-3 text-[15px] font-extrabold tabular-nums transition-transform",
              pulse && "bg-coral-500 scale-110"
            )}
          >
            <ShoppingBag className="size-4" />
            {count}
          </span>
          <span className="relative flex-1 text-center text-[15px] font-extrabold">
            {t("viewMyCart")}
          </span>
          <span className="relative flex flex-col items-end leading-none">
            {hasSavings && (
              <span className="text-[11px] font-semibold text-white/70 tabular-nums line-through">
                {formatDA(raw)}
              </span>
            )}
            <span className="text-base font-black tracking-tight tabular-nums">
              {formatDA(subtotal)}
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
