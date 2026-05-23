"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { rawSubtotal, totalUnits, useCart } from "@/lib/customer/cart-store";
import { formatDA } from "@/lib/utils";

/**
 * Barre sticky en bas de la fiche commerçant : si le panier contient des
 * produits DE CE commerce, propose d'aller au panier / checkout.
 */
export function MerchantCartCta({ merchantId }: { merchantId: string }) {
  const cart = useCart();
  if (cart.merchant_id !== merchantId) return null;
  const count = totalUnits(cart);
  if (count === 0) return null;
  const subtotal = rawSubtotal(cart);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-md">
        <Link
          href="/cart"
          className="bg-primary-600 hover:bg-primary-700 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-white shadow-lg"
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-sm font-semibold">
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
