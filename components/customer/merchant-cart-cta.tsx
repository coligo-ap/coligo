"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ShoppingBag } from "lucide-react";
import {
  rawSubtotal,
  setActiveMerchant,
  totalUnits,
  useCartFor,
} from "@/lib/customer/cart-store";
import { cn, formatDA } from "@/lib/utils";

// =============================================================================
// MerchantCartCta — barre sticky en bas de la fiche commerçant.
// =============================================================================
// Petit effet rebond + flash sur le compteur à chaque ajout (au lieu d'un
// toast intrusif). Le client perçoit l'ajout sans qu'un overlay ne lui
// bouffe l'écran quand il enchaîne plusieurs produits.
// =============================================================================

export function MerchantCartCta({ merchantId }: { merchantId: string }) {
  const t = useTranslations("merchant");
  const cart = useCartFor(merchantId);
  const count = totalUnits(cart);
  const subtotal = rawSubtotal(cart);

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

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-md">
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
          <span className="relative text-base font-black tracking-tight tabular-nums">
            {formatDA(subtotal)}
          </span>
        </Link>
      </div>
    </div>
  );
}
