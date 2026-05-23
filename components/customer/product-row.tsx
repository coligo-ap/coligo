"use client";

import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDA } from "@/lib/utils";
import { addItem, setItemQuantity, useCart } from "@/lib/customer/cart-store";
import { toast } from "@/components/ui/toast";
import type { PublicProduct } from "@/lib/data/customer-catalog";

/**
 * Ligne de produit dans une section de catégorie (Deliveroo style).
 * - Clic n'importe où sur la ligne → ouvre le sheet détails (callback).
 * - Pas encore au panier : un bouton "+" pour ajout direct.
 * - Déjà au panier : un mini-stepper "−  qty  +" sous la miniature.
 *   À qty=1, l'icône "−" devient une corbeille rouge pour bien indiquer
 *   que le clic suivant SUPPRIMERA l'article.
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

  function decrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (!inCart) return;
    // setItemQuantity(_, 0) supprime l'article (filtre dans le store).
    setItemQuantity(inCart.product_id, inCart.quantity - 1);
    if (inCart.quantity === 1) {
      toast.success(`« ${product.name_fr} » retiré du panier`);
    }
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

      {/* Thumbnail + action(s) */}
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <div className="bg-surface-2 relative size-20 overflow-hidden rounded-[12px] sm:size-24">
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
          {!inCart && (
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

        {inCart && (
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
