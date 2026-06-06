"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Flame, Plus, ShoppingBag } from "lucide-react";
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
 * Carrousel « Populaires » (style Uber Eats) : sélection mise en avant en
 * cartes-photo horizontales avec note/promo, prix et bouton + d'ajout rapide.
 * La logique panier (mono-commerçant) est identique aux lignes produit.
 */
export function PopularCarousel({
  merchant,
  products,
  promoPriceById,
  onOpenDetail,
}: {
  merchant: Merchant;
  products: PublicProduct[];
  promoPriceById: Record<string, number>;
  onOpenDetail: (p: PublicProduct) => void;
}) {
  const t = useTranslations("merchant");
  if (products.length === 0) return null;

  return (
    <section className="-mx-4 mb-2 lg:-mx-6">
      <h2 className="font-display text-foreground mb-3 flex items-center gap-2 px-4 text-lg font-bold lg:px-6">
        <Flame className="text-coral-500 size-5" />
        {t("popular")}
      </h2>
      <div className="flex snap-x snap-mandatory [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 lg:px-6 [&::-webkit-scrollbar]:hidden">
        {products.map((p) => (
          <PopCard
            key={p.id}
            merchant={merchant}
            product={p}
            promoUnitPriceDa={promoPriceById[p.id] ?? null}
            onOpenDetail={() => onOpenDetail(p)}
          />
        ))}
      </div>
    </section>
  );
}

function PopCard({
  merchant,
  product,
  promoUnitPriceDa,
  onOpenDetail,
}: {
  merchant: Merchant;
  product: PublicProduct;
  promoUnitPriceDa: number | null;
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
        {hasPromo && promoPct > 0 && (
          <span className="bg-coral-500 absolute start-2 top-2 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold text-white shadow-sm">
            −{promoPct}%
          </span>
        )}
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
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-primary-700 text-[15px] font-black tabular-nums">
            {formatDA(price)}
          </span>
          {hasPromo && (
            <span className="text-subtle text-[11px] tabular-nums line-through">
              {formatDA(product.price_da)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
