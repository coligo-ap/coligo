"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  BadgePercent,
  Check,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  setActiveMerchant,
  setItemQuantity,
  useCartFor,
} from "@/lib/customer/cart-store";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import { cldUrl } from "@/lib/images/cloudinary";
import {
  formatQty,
  isFractionalUnit,
  maxQtyFor,
  minQtyFor,
  qtyStep,
  roundQty,
} from "@/lib/units";
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
  quantityOffer,
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
  quantityOffer?: { buy: number; get: number } | null;
  onOpenDetail: () => void;
}) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const { requestAdd } = useCartAdd();
  const cart = useCartFor(merchant.id);
  // Produit à options/variantes : pas d'ajout rapide (il faut choisir) → le
  // « + » ouvre la fiche. Pour un produit simple, line_key === product_id.
  const hasOptions = (product.option_groups?.length ?? 0) > 0;
  const inCart = hasOptions
    ? undefined
    : cart.items.find((i) => i.line_key === product.id);
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
    // Options obligatoires → on ouvre la fiche pour choisir (pas d'ajout aveugle).
    // Vente au poids/volume (kg, L, m) → idem : le client DOIT choisir la
    // quantité sur la fiche (pas d'ajout aveugle d'« 1 kg »).
    if (hasOptions || isFractionalUnit(product.unit)) {
      onOpenDetail();
      return;
    }
    // Mono-commerçant : si conflit, la modale s'ouvre et requestAdd renvoie
    // false → on ne flashe pas (l'ajout n'est pas encore confirmé).
    const addedNow = requestAdd(merchant, {
      product_id: product.id,
      name: product.name_fr,
      name_ar: product.name_ar,
      unit: product.unit,
      min_qty: product.min_qty,
      max_qty: product.max_qty,
      unit_price_da: product.price_da,
      image_url: product.image_url,
      category_title: product.category,
      // Départ direct au minimum imposé par le commerçant (ex. min 2 pièces).
      quantity: minQtyFor(product.unit, product.min_qty),
    });
    if (addedNow) flash();
  }

  const step = qtyStep(product.unit);
  const minQ = minQtyFor(product.unit, product.min_qty);
  const maxQ = maxQtyFor(product.unit, product.max_qty, product.stock_qty);

  function increment(e: React.MouseEvent) {
    e.stopPropagation();
    if (!inCart) return;
    setActiveMerchant(merchant.id);
    setItemQuantity(
      inCart.line_key,
      Math.min(maxQ, roundQty(inCart.quantity + step))
    );
    flash();
  }

  function decrement(e: React.MouseEvent) {
    e.stopPropagation();
    if (!inCart) return;
    setActiveMerchant(merchant.id);
    const next = roundQty(inCart.quantity - step);
    // Sous le minimum (pas d'unité ou min commerçant) → la ligne saute.
    // Pas de toast : le stepper qui redevient « + » est le retour visuel.
    setItemQuantity(inCart.line_key, next < minQ ? 0 : next);
  }

  return (
    // ⚠ PAS un <button> : la ligne CONTIENT de vrais boutons (+ / stepper) et
    // un <button> imbriqué dans un <button> est du HTML INVALIDE → échec
    // d'hydratation React → DOM corrompu (sections dupliquées, layout cassé).
    // div role="button" + clavier = même accessibilité, HTML valide.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className={cn(
        "hover:bg-surface-2 group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-start transition-colors",
        isOut && "opacity-60"
      )}
    >
      {/* Vignette (overflow caché → le badge promo reste dedans). Photo
          entière sur fond blanc (object-contain), comme les cartes produit. */}
      <div className="border-border relative size-16 shrink-0 overflow-hidden rounded-[8px] border bg-white">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(product.image_url, {
                width: 160,
                height: 160,
                crop: "fit",
              }) ?? product.image_url
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBag className="text-subtle size-6" />
          </div>
        )}
        {hasPromo && promoPct > 0 && (
          <span className="bg-accent-600 absolute top-1 left-1 z-10 rounded-[6px] px-1.5 py-0.5 text-[9px] font-extrabold text-white shadow-sm">
            −{promoPct}%
          </span>
        )}
      </div>

      {/* Nom + prix + stock */}
      <div className="min-w-0 flex-1">
        <h4 className="text-foreground line-clamp-1 text-sm font-semibold">
          {product.name_fr}
        </h4>
        <div className="mt-1 flex items-center gap-1.5">
          {hasPromo && (
            <BadgePercent
              className="text-accent-600 size-3.5 shrink-0"
              aria-label={t("discountAppliedAria")}
            />
          )}
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              hasPromo ? "text-accent-600" : "text-foreground"
            )}
          >
            {formatDA(price)}
          </span>
          {hasPromo && (
            <span className="text-subtle text-xs tabular-nums line-through">
              {formatDA(product.price_da)}
            </span>
          )}
          {quantityOffer && (
            // Étiquette cohérente avec « Offert » : rose foncé + blanc.
            <span className="bg-accent-600 ms-auto inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white">
              {t("buyGetLabel", {
                buy: quantityOffer.buy,
                get: quantityOffer.get,
              })}
            </span>
          )}
        </div>
        {isOut ? (
          <div className="text-danger-600 mt-1 text-[11px] font-bold">
            {t("outOfStock")}
          </div>
        ) : isLow ? (
          <div className="text-warning-700 mt-1 flex items-center gap-1 text-[11px] font-bold">
            <AlertTriangle className="size-3" />
            {t("onlyLeft", { count: product.stock_qty ?? 0 })}
          </div>
        ) : isOk ? (
          <div className="text-success-700 mt-1 flex items-center gap-1 text-[11px] font-bold">
            <Check className="size-3" />
            {t("inStock")}
          </div>
        ) : null}
      </div>

      {/* + ou stepper */}
      <div className="shrink-0">
        {isOut ? (
          <span
            aria-label={t("outOfStock")}
            className="bg-surface-3 text-subtle flex size-9 cursor-not-allowed items-center justify-center rounded-full"
          >
            <Plus className="size-4" />
          </span>
        ) : !inCart ? (
          <button
            type="button"
            onClick={quickAdd}
            aria-label={t("addToCart")}
            className={cn(
              "flex size-9 items-center justify-center rounded-full border shadow-sm transition-transform active:scale-90",
              added
                ? "border-success-600 bg-success-600 scale-110 text-white"
                : "border-border text-accent-600 hover:border-accent-300 bg-white"
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
                inCart.quantity <= minQ
                  ? t("removeFromCartAria", { name: product.name_fr })
                  : t("removeOne")
              }
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors",
                inCart.quantity <= minQ
                  ? "bg-danger-50 text-danger-600 hover:bg-danger-100"
                  : "text-primary-700 hover:bg-primary-100"
              )}
            >
              {inCart.quantity <= minQ ? (
                <Trash2 className="size-3.5" />
              ) : (
                <Minus className="size-3.5" />
              )}
            </button>
            <span className="text-foreground min-w-[1.5ch] text-center text-sm font-bold whitespace-nowrap tabular-nums">
              {isFractionalUnit(product.unit)
                ? formatQty(inCart.quantity, product.unit, locale)
                : inCart.quantity}
            </span>
            <button
              type="button"
              onClick={increment}
              aria-label={t("addOne")}
              className="bg-primary-600 hover:bg-primary-700 flex size-7 items-center justify-center rounded-full text-white"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
