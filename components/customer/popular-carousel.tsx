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
    const ok = requestAdd(merchant, {
      product_id: product.id,
      name: product.name_fr,
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
        "bg-surface w-[158px] shrink-0 snap-start overflow-hidden rounded-[20px] text-start shadow-[0_2px_4px_rgba(20,20,50,0.04),0_14px_30px_-14px_rgba(40,35,90,0.28)] transition-transform active:scale-[0.97]",
        isOut && "opacity-60"
      )}
    >
      <div className="bg-surface-2 relative h-[112px] w-full overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(product.image_url, {
                width: 340,
                height: 240,
                crop: "fill",
                gravity: "auto",
              }) ?? product.image_url
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBag className="text-subtle size-7" />
          </div>
        )}

        {/* Badges (haut-start) : réduction % et/ou « offert » (empilés). */}
        <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
          {hasPromo && promoPct > 0 && (
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[9.5px] font-extrabold text-white shadow-sm">
              −{promoPct}%
            </span>
          )}
          {quantityOffer && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[9.5px] font-extrabold text-white shadow-sm">
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
              "absolute end-2 bottom-2 grid size-9 place-items-center rounded-full shadow-md transition-transform active:scale-90",
              added ? "bg-success-600 text-white" : "text-primary-700 bg-white"
            )}
          >
            {added ? <Check className="size-4" /> : <Plus className="size-4" />}
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="text-foreground line-clamp-2 h-8 text-[13px] leading-tight font-semibold">
          {product.name_fr}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {hasPromo && (
            <BadgePercent
              className="size-3.5 shrink-0 text-rose-600"
              aria-label={t("discountAppliedAria")}
            />
          )}
          <span
            className={cn(
              "text-[15px] font-black tabular-nums",
              hasPromo ? "text-rose-600" : "text-primary-700"
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
          <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10.5px] leading-tight font-extrabold text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
            <Gift className="size-3 shrink-0" />
            {offerLabel}
          </div>
        )}
      </div>
    </button>
  );
}
