"use client";

import { Plus, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDA } from "@/lib/utils";
import { addItem, setItemQuantity, useCart } from "@/lib/customer/cart-store";
import { toast } from "@/components/ui/toast";
import type { PublicProduct } from "@/lib/data/customer-catalog";

/**
 * Ligne de produit dans une section de catégorie (Deliveroo style).
 * - Clic n'importe où sur la ligne → ouvre le sheet détails (callback).
 * - Bouton "+" : ajout direct au panier sans ouvrir le sheet.
 * - Si déjà au panier : affiche un badge avec la quantité.
 */
export function ProductRow({
  merchant,
  product,
  promoUnitPriceDa,
  onOpenDetail,
}: {
  merchant: { id: string; slug: string; name: string };
  product: PublicProduct;
  promoUnitPriceDa: number | null;
  onOpenDetail: () => void;
}) {
  const cart = useCart();
  const inCart = cart.items.find((i) => i.product_id === product.id);
  const hasPromo =
    promoUnitPriceDa != null && promoUnitPriceDa < product.price_da;
  const price = hasPromo ? promoUnitPriceDa! : product.price_da;

  function quickAdd(e: React.MouseEvent) {
    e.stopPropagation();
    const res = addItem(merchant, {
      product_id: product.id,
      name: product.name_fr,
      unit_price_da: product.price_da,
      image_url: product.image_url,
      category_title: product.category,
    });
    if (!res.ok && res.mismatch) {
      toast.error(
        "Ton panier contient déjà des produits d'un autre commerce. Vide-le pour ajouter celui-ci."
      );
      return;
    }
    toast.success("Ajouté au panier");
  }

  function increment(e: React.MouseEvent) {
    e.stopPropagation();
    if (inCart) setItemQuantity(inCart.product_id, inCart.quantity + 1);
  }

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className="hover:bg-surface-2 group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
    >
      <div className="min-w-0 flex-1">
        <h4 className="text-foreground line-clamp-1 text-sm font-semibold">
          {product.name_fr}
        </h4>
        {product.description_fr && (
          <p className="text-muted mt-0.5 line-clamp-2 text-xs">
            {product.description_fr}
          </p>
        )}
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              hasPromo ? "text-success-700" : "text-foreground"
            )}
          >
            {formatDA(price)}
          </span>
          {hasPromo && (
            <span className="text-subtle text-xs tabular-nums line-through">
              {formatDA(product.price_da)}
            </span>
          )}
          {product.stock_qty != null && product.stock_qty <= 5 && (
            <Badge tone="warning">{product.stock_qty} restants</Badge>
          )}
        </div>
      </div>

      {/* Thumbnail + action */}
      <div className="relative">
        <div className="bg-surface-2 size-20 shrink-0 overflow-hidden rounded-[12px] sm:size-24">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt=""
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
              <ShoppingBag className="text-subtle size-7" />
            </div>
          )}
        </div>
        {inCart ? (
          <button
            type="button"
            onClick={increment}
            aria-label="Ajouter 1"
            className="bg-primary-600 hover:bg-primary-700 absolute -right-2 -bottom-2 flex items-center gap-1 rounded-full border-2 border-white px-2.5 py-1 text-xs font-bold text-white shadow"
          >
            {inCart.quantity}
            <Plus className="size-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={quickAdd}
            aria-label="Ajouter au panier"
            className="bg-primary-600 hover:bg-primary-700 absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    </button>
  );
}
