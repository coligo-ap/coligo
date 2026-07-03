"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BadgePercent,
  Check,
  Flame,
  Gift,
  Plus,
  ShoppingBag,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import { cldUrl } from "@/lib/images/cloudinary";
import { isFractionalUnit, minQtyFor } from "@/lib/units";
import type { PublicProduct } from "@/lib/data/customer-catalog";

type Merchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};

/**
 * Carrousel horizontal de cartes-photo (style Uber Eats) RÉUTILISABLE :
 * « Populaires », « Achat offert », etc. Titre + icône paramétrables. La logique
 * panier (mono-commerçant) et l'affichage promo sont identiques aux lignes.
 */
export function ProductCarousel({
  title,
  icon,
  merchant,
  products,
  promoPriceById,
  quantityOfferByProduct,
  onOpenDetail,
}: {
  title: string;
  icon: React.ReactNode;
  merchant: Merchant;
  products: PublicProduct[];
  promoPriceById: Record<string, number>;
  quantityOfferByProduct?: Record<string, { buy: number; get: number }>;
  onOpenDetail: (p: PublicProduct) => void;
}) {
  if (products.length === 0) return null;

  return (
    <section className="-mx-4 mb-2 lg:-mx-6">
      <h2 className="font-display text-foreground mb-3 flex items-center gap-2 px-4 text-lg font-bold lg:px-6">
        {icon}
        <span className="truncate">{title}</span>
      </h2>
      <div className="flex snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 lg:px-6 [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <PopCard
            key={p.id}
            merchant={merchant}
            product={p}
            promoUnitPriceDa={promoPriceById[p.id] ?? null}
            quantityOffer={quantityOfferByProduct?.[p.id] ?? null}
            onOpenDetail={() => onOpenDetail(p)}
          />
        ))}
      </div>
    </section>
  );
}

/** Carrousel « Populaires » — wrapper du carrousel générique. */
export function PopularCarousel(props: {
  merchant: Merchant;
  products: PublicProduct[];
  promoPriceById: Record<string, number>;
  quantityOfferByProduct?: Record<string, { buy: number; get: number }>;
  onOpenDetail: (p: PublicProduct) => void;
}) {
  const t = useTranslations("merchant");
  return (
    <ProductCarousel
      title={t("popular")}
      icon={<Flame className="text-coral-500 size-5" />}
      {...props}
    />
  );
}

export function PopCard({
  merchant,
  product,
  promoUnitPriceDa,
  quantityOffer,
  onOpenDetail,
}: {
  merchant: Merchant;
  product: PublicProduct;
  promoUnitPriceDa: number | null;
  quantityOffer?: { buy: number; get: number } | null;
  onOpenDetail: () => void;
}) {
  const t = useTranslations("merchant");
  const { requestAdd } = useCartAdd();
  const hasPromo =
    promoUnitPriceDa != null && promoUnitPriceDa < product.price_da;
  const price = hasPromo ? promoUnitPriceDa! : product.price_da;
  const promoPct = hasPromo
    ? Math.round(
        ((product.price_da - promoUnitPriceDa!) / product.price_da) * 100
      )
    : 0;

  const tracked = product.stock_qty != null;
  const isOut =
    product.is_available === false || (tracked && product.stock_qty! <= 0);

  const [added, setAdded] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function quickAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (isOut) return;
    // Options obligatoires ou vente au poids/volume → la fiche s'ouvre (le
    // client DOIT choisir), comme sur les lignes produit.
    if (
      (product.option_groups?.length ?? 0) > 0 ||
      isFractionalUnit(product.unit)
    ) {
      onOpenDetail();
      return;
    }
    const ok = requestAdd(merchant, {
      product_id: product.id,
      name: product.name_fr,
      name_ar: product.name_ar,
      unit: product.unit,
      min_qty: product.min_qty,
      max_qty: product.max_qty,
      quantity: minQtyFor(product.unit, product.min_qty),
      unit_price_da: product.price_da,
      image_url: product.image_url,
      category_title: product.category,
    });
    if (ok) {
      setAdded(true);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setAdded(false), 450);
    }
  }

  const offerLabel = quantityOffer
    ? t("buyGetLabel", { buy: quantityOffer.buy, get: quantityOffer.get })
    : null;

  return (
    <button
      type="button"
      onClick={onOpenDetail}
      className={cn(
        "w-[158px] shrink-0 snap-start text-start transition-transform active:scale-[0.97]",
        isOut && "opacity-60"
      )}
    >
      {/* Cadre façon Yassir : la bordure n'entoure QUE la photo (fond blanc,
          produit entier) ; le texte vit dessous, hors cadre. */}
      <div className="border-border relative h-[132px] w-full overflow-hidden rounded-[14px] border bg-white">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(product.image_url, {
                width: 340,
                height: 240,
                crop: "fit",
              }) ?? product.image_url
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-3"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBag className="text-subtle size-7" />
          </div>
        )}

        {/* Badges (haut-start) : réduction % et/ou « offert » (empilés). */}
        <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
          {hasPromo && promoPct > 0 && (
            <span className="bg-accent-600 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold text-white shadow-sm">
              −{promoPct}%
            </span>
          )}
          {quantityOffer && (
            <span className="bg-accent-600 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold text-white shadow-sm">
              <Gift className="size-3" />
              {t("offered")}
            </span>
          )}
        </div>

        {!isOut && (
          <span
            onClick={quickAdd}
            aria-label={t("addToCart")}
            className={cn(
              "absolute end-2 bottom-2 grid size-9 place-items-center rounded-full border shadow-sm transition-transform active:scale-90",
              added
                ? "border-success-600 bg-success-600 text-white"
                : "border-border text-accent-600 bg-white"
            )}
          >
            {added ? <Check className="size-4" /> : <Plus className="size-4" />}
          </span>
        )}
      </div>
      <div className="px-1 pt-2 pb-1">
        <div className="text-foreground line-clamp-2 h-8 text-[13px] leading-tight font-semibold">
          {product.name_fr}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {hasPromo && (
            <BadgePercent
              className="text-accent-600 size-3.5 shrink-0"
              aria-label={t("discountAppliedAria")}
            />
          )}
          <span
            className={cn(
              "text-[15px] font-black tabular-nums",
              hasPromo ? "text-accent-600" : "text-foreground"
            )}
          >
            {formatDA(price)}
          </span>
          {hasPromo && (
            <span className="text-subtle text-[11px] tabular-nums line-through">
              {formatDA(product.price_da)}
            </span>
          )}
        </div>
        {offerLabel && (
          <div className="bg-accent-50 text-accent-600 dark:bg-accent-950/40 dark:text-accent-300 mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] leading-tight font-extrabold">
            <Gift className="size-3 shrink-0" />
            {offerLabel}
          </div>
        )}
      </div>
    </button>
  );
}
