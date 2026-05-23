"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import { addItem, useCart } from "@/lib/customer/cart-store";
import type { PublicProduct } from "@/lib/data/customer-catalog";

type Props = {
  merchant: { id: string; slug: string; name: string };
  product: PublicProduct;
  /** Prix promo si applicable (déjà calculé en amont). */
  promoUnitPriceDa?: number | null;
};

export function ProductCard({ merchant, product, promoUnitPriceDa }: Props) {
  const cart = useCart();
  const inCart = cart.items.find((i) => i.product_id === product.id);
  const hasPromo =
    promoUnitPriceDa != null && promoUnitPriceDa < product.price_da;
  const effectivePrice = hasPromo ? promoUnitPriceDa! : product.price_da;

  function tryAdd() {
    const res = addItem(merchant, {
      product_id: product.id,
      name: product.name_fr,
      unit_price_da: product.price_da, // prix CATALOGUE (le moteur recalcule)
      image_url: product.image_url,
      category_title: product.category,
    });
    if (!res.ok && res.mismatch) {
      toast.error(
        `Ton panier contient déjà des produits d'un autre commerce. Vide-le pour ajouter celui-ci.`
      );
      return;
    }
    toast.success("Ajouté au panier");
  }

  return (
    <div className="border-border bg-surface group flex gap-3 rounded-[14px] border p-3">
      {/* Thumbnail */}
      <div className="bg-surface-2 size-20 shrink-0 overflow-hidden rounded-[10px] sm:size-24">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBag className="text-subtle size-6" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground line-clamp-2 text-sm font-semibold">
            {product.name_fr}
          </h3>
          {product.description_fr && (
            <p className="text-muted mt-0.5 line-clamp-2 text-xs">
              {product.description_fr}
            </p>
          )}
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              className={cn(
                "text-sm font-bold tabular-nums",
                hasPromo ? "text-success-700" : "text-foreground"
              )}
            >
              {formatDA(effectivePrice)}
            </span>
            {hasPromo && (
              <span className="text-subtle text-xs tabular-nums line-through">
                {formatDA(product.price_da)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-subtle text-[10px]">
            {product.stock_qty != null && product.stock_qty <= 5
              ? `Plus que ${product.stock_qty}`
              : product.unit !== "piece"
                ? `Par ${product.unit}`
                : ""}
          </span>
          {inCart ? (
            <QtyStepper item={inCart.product_id} qty={inCart.quantity} />
          ) : (
            <Button type="button" size="sm" onClick={tryAdd}>
              <Plus className="size-3.5" />
              Ajouter
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function QtyStepper({ item, qty }: { item: string; qty: number }) {
  const [busy, setBusy] = useState(false);
  function update(next: number) {
    setBusy(true);
    import("@/lib/customer/cart-store").then(({ setItemQuantity }) => {
      setItemQuantity(item, next);
      setBusy(false);
    });
  }
  return (
    <div className="bg-primary-50 inline-flex items-center gap-2 rounded-full p-1">
      <button
        type="button"
        onClick={() => update(qty - 1)}
        disabled={busy}
        className="text-primary-700 hover:bg-primary-100 flex size-6 items-center justify-center rounded-full"
        aria-label="Retirer 1"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="text-foreground min-w-[1.5ch] text-center text-sm font-semibold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => update(qty + 1)}
        disabled={busy}
        className="bg-primary-600 hover:bg-primary-700 flex size-6 items-center justify-center rounded-full text-white"
        aria-label="Ajouter 1"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
