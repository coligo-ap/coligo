"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDA } from "@/lib/utils";
import { addItem, useCart, setItemQuantity } from "@/lib/customer/cart-store";
import { toast } from "@/components/ui/toast";
import type { PublicProduct } from "@/lib/data/customer-catalog";

type Props = {
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  };
  product: PublicProduct | null;
  promoUnitPriceDa: number | null;
  onClose: () => void;
};

/**
 * Sheet bottom (mobile) / dialog centré (desktop) avec les détails du
 * produit : image en grand, descriptions FR/AR, prix, sélecteur de quantité,
 * bouton "Ajouter au panier — X DA".
 */
export function ProductDetailSheet({
  merchant,
  product,
  promoUnitPriceDa,
  onClose,
}: Props) {
  const cart = useCart();
  const [qty, setQty] = useState(1);

  // Reset la quantité quand on ouvre un autre produit.
  useEffect(() => {
    if (product) {
      const inCart = cart.items.find((i) => i.product_id === product.id);
      setQty(inCart?.quantity ?? 1);
    }
  }, [product, cart.items]);

  // Echap pour fermer.
  useEffect(() => {
    if (!product) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [product, onClose]);

  if (!product) return null;

  const hasPromo =
    promoUnitPriceDa != null && promoUnitPriceDa < product.price_da;
  const price = hasPromo ? promoUnitPriceDa! : product.price_da;
  const lineTotal = price * qty;
  const inCart = cart.items.find((i) => i.product_id === product.id);

  function addOrUpdate() {
    if (inCart) {
      setItemQuantity(product!.id, qty);
      toast.success(`Quantité mise à ${qty}`);
    } else {
      // addItem ajoute par incrément ; on injecte la quantité voulue d'un coup.
      // Plus de blocage en cas de "panier d'un autre commerce" — c'est géré
      // bienveillamment au checkout (prompt 16).
      addItem(merchant, {
        product_id: product!.id,
        name: product!.name_fr,
        unit_price_da: product!.price_da,
        image_url: product!.image_url,
        category_title: product!.category,
        quantity: qty,
      });
      // Pas de toast — le CTA panier rebondit + son compteur s'incrémente.
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal
    >
      <div className="bg-surface flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] shadow-xl sm:rounded-[20px]">
        {/* Image en grand */}
        <div className="bg-surface-2 relative aspect-[16/10] w-full overflow-hidden">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
              <ShoppingBag className="text-subtle size-12" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="bg-foreground/60 hover:bg-foreground/80 absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-white backdrop-blur"
            aria-label="Fermer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-foreground text-xl leading-tight font-bold">
            {product.name_fr}
          </h2>
          {product.name_ar && (
            <p
              className="text-foreground mt-0.5 text-sm font-semibold"
              dir="rtl"
            >
              {product.name_ar}
            </p>
          )}

          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                hasPromo ? "text-success-700" : "text-foreground"
              )}
            >
              {formatDA(price)}
            </span>
            {hasPromo && (
              <span className="text-subtle text-sm tabular-nums line-through">
                {formatDA(product.price_da)}
              </span>
            )}
            {product.unit && product.unit !== "piece" && (
              <span className="text-muted text-xs">/ {product.unit}</span>
            )}
          </div>

          {(product.description_fr || product.description_ar) && (
            <div className="mt-4 space-y-2">
              {product.description_fr && (
                <p className="text-foreground text-sm">
                  {product.description_fr}
                </p>
              )}
              {product.description_ar && (
                <p className="text-foreground text-sm" dir="rtl">
                  {product.description_ar}
                </p>
              )}
            </div>
          )}

          {product.stock_qty != null && product.stock_qty <= 5 && (
            <p className="text-warning-700 mt-3 text-xs font-medium">
              Plus que {product.stock_qty} en stock
            </p>
          )}
        </div>

        {/* Footer fixe : qty + CTA */}
        <div className="border-border bg-surface flex items-center gap-3 border-t p-4">
          <div className="bg-surface-2 inline-flex items-center gap-3 rounded-full p-1">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="text-foreground hover:bg-surface-3 flex size-8 items-center justify-center rounded-full"
              aria-label="Retirer 1"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-foreground min-w-[1.5ch] text-center text-sm font-bold tabular-nums">
              {qty}
            </span>
            <button
              type="button"
              onClick={() =>
                setQty((q) =>
                  product.stock_qty != null
                    ? Math.min(product.stock_qty, q + 1)
                    : q + 1
                )
              }
              className="bg-primary-600 hover:bg-primary-700 flex size-8 items-center justify-center rounded-full text-white"
              aria-label="Ajouter 1"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <Button
            type="button"
            className="flex-1"
            size="lg"
            onClick={addOrUpdate}
          >
            {inCart ? "Mettre à jour" : "Ajouter"} · {formatDA(lineTotal)}
          </Button>
        </div>
      </div>
    </div>
  );
}
