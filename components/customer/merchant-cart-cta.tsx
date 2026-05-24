"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
            "bg-primary-600 hover:bg-primary-700 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-white shadow-lg transition-transform",
            pulse && "scale-[1.03]"
          )}
        >
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-sm font-semibold transition-transform",
              pulse && "bg-coral-500 scale-110"
            )}
          >
            <ShoppingBag className="size-4" />
            {count}
          </span>
          <span className="text-sm font-semibold">Voir mon panier</span>
          <span className="text-sm font-bold tabular-nums">
            {formatDA(subtotal)}
          </span>
        </Link>
      </div>
    </div>
  );
}
