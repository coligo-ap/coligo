"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  addItem,
  setActiveMerchant,
  setItemQuantity,
  useCartFor,
} from "@/lib/customer/cart-store";
import { toast } from "@/components/ui/toast";
import { cldUrl } from "@/lib/images/cloudinary";
import type { PublicProduct } from "@/lib/data/customer-catalog";

/**
 * Ligne de produit (style Uber grocery) :
 *  - vignette photo (badge promo −X% À L'INTÉRIEUR, overflow caché),
 *  - nom + prix (violet, prix barré si promo),
 *  - indicateur de stock (En stock / Plus que N / Épuisé),
 *  - bouton + violet → stepper (corbeille à qty=1), désactivé si épuisé.
 */
export function ProductRow({
  merchant,
  product,
  promoUnitPriceDa,
  onOpenDetail,
}: {
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  };
  product: PublicProduct;
  promoUnitPriceDa: number | null;
  onOpenDetail: () => void;
}) {
  const cart = useCartFor(merchant.id);
  const inCart = cart.items.find((i) => i.product_id === product.id);
  const hasPromo =
    promoUnitPriceDa != null && promoUnitPriceDa < product.price_da;
  const price = hasPromo ? promoUnitPriceDa! : product.price_da;
  const promoPct = hasPromo
    ? Math.round(
        ((product.price_da - promoUnitPriceDa!) / product.price_da) * 100
      )
    : 0;

  // État de stock : épuisé / faible / en stock / non suivi.
  const tracked = product.stock_qty != null;
  const isOut =
    product.is_available === false || (tracked && product.stock_qty! <= 0);
  const isLow = !isOut && tracked && product.stock_qty! <= 5;
  const isOk = !isOut && tracked && product.stock_qty! > 5;

  // Flash vert bref à l'ajout.
  const [added, setAdded] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = () => {
    setAdded(true);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setAdded(false), 450);
  };

  function quickAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (isOut) return;
    addItem(merchant, {
      product_id: product.id,
      name: product.name_fr,
      unit_price_da: product.price_da,
      image_url: product.image_url,
      category_title: product.category,
    });
    flash();
  }

  function increment(e: React.MouseEvent) {
    e.stopPropagation();
    if (!inCart) return;
    setActiveMerchant(merchant.id);
    setItemQuantity(inCart.product_id, inCart.quantity + 1);
    flash();
  }

  function decrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (!inCart) return;
    setActiveMerchant(merchant.id);
    setItemQuantity(inCart.product_id, inCart.quantity - 1);
    if (inCart.quantity === 1) {
      toast.success(`« ${product.name_fr} » retiré du panier`);
    }
  }

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className={cn(
        "hover:bg-surface-2 group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        isOut && "opacity-60"
      )}
    >
      {/* Vignette (overflow caché → le badge promo reste dedans). */}
      <div className="bg-surface-2 relative size-16 shrink-0 overflow-hidden rounded-[12px]">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(product.image_url, {
                width: 160,
                height: 160,
                crop: "fill",
                gravity: "auto",
              }) ?? product.image_url
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBag className="text-subtle size-6" />
          </div>
        )}
        {hasPromo && promoPct > 0 && (
          <span className="absolute top-1 left-1 z-10 rounded-[6px] bg-[#FF5A3C] px-1.5 py-0.5 text-[9px] font-extrabold text-white shadow-sm">
            −{promoPct}%
          </span>
        )}
      </div>

      {/* Nom + prix + stock */}
      <div className="min-w-0 flex-1">
        <h4 className="text-foreground line-clamp-1 text-sm font-semibold">
          {product.name_fr}
        </h4>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-primary-700 text-sm font-bold tabular-nums">
            {formatDA(price)}
          </span>
          {hasPromo && (
            <span className="text-subtle text-xs tabular-nums line-through">
              {formatDA(product.price_da)}
            </span>
          )}
        </div>
        {isOut ? (
          <div className="text-danger-600 mt-1 text-[11px] font-bold">
            Épuisé
          </div>
        ) : isLow ? (
          <div className="text-warning-700 mt-1 flex items-center gap-1 text-[11px] font-bold">
            <AlertTriangle className="size-3" />
            Plus que {product.stock_qty}
          </div>
        ) : isOk ? (
          <div className="text-success-700 mt-1 flex items-center gap-1 text-[11px] font-bold">
            <Check className="size-3" />
            En stock
          </div>
        ) : null}
      </div>

      {/* + ou stepper */}
      <div className="shrink-0">
        {isOut ? (
          <span
            aria-label="Épuisé"
            className="bg-surface-3 text-subtle flex size-9 cursor-not-allowed items-center justify-center rounded-full"
          >
            <Plus className="size-4" />
          </span>
        ) : !inCart ? (
          <button
            type="button"
            onClick={quickAdd}
            aria-label="Ajouter au panier"
            className={cn(
              "flex size-9 items-center justify-center rounded-full text-white shadow-md transition-transform active:scale-90",
              added
                ? "bg-success-600 scale-110"
                : "bg-primary-600 hover:bg-primary-700"
            )}
          >
            {added ? <Check className="size-4" /> : <Plus className="size-4" />}
          </button>
        ) : (
          <div
            className="bg-primary-50 inline-flex items-center gap-1 rounded-full p-0.5 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={decrement}
              aria-label={
                inCart.quantity === 1
                  ? `Retirer ${product.name_fr} du panier`
                  : "Retirer 1"
              }
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                inCart.quantity === 1
                  ? "bg-danger-50 text-danger-600 hover:bg-danger-100"
                  : "text-primary-700 hover:bg-primary-100"
              )}
            >
              {inCart.quantity === 1 ? (
                <Trash2 className="size-3.5" />
              ) : (
                <Minus className="size-3.5" />
              )}
            </button>
            <span className="text-foreground min-w-[1.5ch] text-center text-sm font-bold tabular-nums">
              {inCart.quantity}
            </span>
            <button
              type="button"
              onClick={increment}
              aria-label="Ajouter 1"
              className="bg-primary-600 hover:bg-primary-700 flex size-7 items-center justify-center rounded-full text-white"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </button>
  );
}
