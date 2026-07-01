"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromoBanner } from "@/lib/data/promo-banners";

// =============================================================================
// PromoBannerCarousel — carrousel scroll-snap de bannières éditoriales.
// =============================================================================
// Purement VISUEL — pas de mécanique de code promo. Les bannières viennent de
// la table `promo_banners` (RLS filtre déjà active + fenêtre temporelle).
//
// Pas de carrousel auto-play (anti-pattern UX — distrait). Le user scrolle
// horizontalement, les points de pagination cliquables permettent de sauter.
// =============================================================================

type Props = {
  banners: PromoBanner[];
};

const ACCENT_CLASSES: Record<PromoBanner["accent"], string> = {
  violet: "from-primary-700 via-primary-600 to-primary-500 text-white",
  coral: "from-coral-700 via-coral-600 to-coral-500 text-white",
  mint: "from-mint-700 via-mint-600 to-mint-500 text-white",
  amber: "from-amber-600 via-amber-500 to-amber-400 text-foreground",
  dark: "from-foreground via-foreground/95 to-foreground/85 text-white",
};

export function PromoBannerCarousel({ banners }: Props) {
  const [active, setActive] = useState(0);
  const t = useTranslations("browse");
  if (banners.length === 0) return null;

  // Une bannière SEULE occupe toute la largeur. Dès qu'il y en a plusieurs, on
  // rétrécit LÉGÈREMENT chaque diapo pour laisser DÉPASSER la suivante (indice
  // visuel « scrolle pour en voir plus »). Le snap-center cale chaque diapo au
  // centre → les voisines pointent des deux côtés.
  const multi = banners.length > 1;

  return (
    <section className="space-y-2">
      <div
        className="-mx-4 flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto pb-2 lg:-mx-6 [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          // En RTL, `scrollLeft` est négatif (start = 0, swipe → valeurs < 0).
          // `Math.abs` rend le calcul d'index correct dans les deux sens.
          const idx = Math.round(
            Math.abs(el.scrollLeft) / (el.firstElementChild?.clientWidth || 1)
          );
          if (idx !== active) setActive(idx);
        }}
      >
        {banners.map((b) => (
          <div
            key={b.id}
            className={cn(
              "shrink-0 snap-center px-2 first:ps-4 last:pe-4 lg:px-3 lg:first:ps-6 lg:last:pe-6",
              multi ? "w-[90%] min-w-[90%]" : "w-full min-w-full px-4 lg:px-6"
            )}
          >
            <Banner banner={b} />
          </div>
        ))}
      </div>

      {banners.length > 1 && (
        <div
          className="flex justify-center gap-1.5"
          role="tablist"
          aria-label={t("promoBannersLabel")}
        >
          {banners.map((b, i) => (
            <span
              key={b.id}
              role="tab"
              aria-selected={i === active}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === active ? "bg-primary-600 w-4" : "bg-border-strong w-1.5"
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Banner({ banner }: { banner: PromoBanner }) {
  const accentClass = ACCENT_CLASSES[banner.accent];
  const hasImg = !!banner.image_url;
  const fit = banner.image_fit ?? "overlay";
  // En mode image PLEINE (cover) ou ENTIÈRE (contain), un voile dégradé bas→haut
  // garde le texte lisible par-dessus n'importe quelle image.
  const scrim = hasImg && fit !== "overlay";
  const content = (
    <article
      className={cn(
        "relative flex w-full flex-col justify-between overflow-hidden rounded-[20px] bg-gradient-to-br px-5 py-5 shadow-md",
        accentClass
      )}
      style={{ minHeight: 140 }}
    >
      {hasImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={banner.image_url!}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full",
            fit === "cover"
              ? "object-cover"
              : fit === "contain"
                ? "object-contain"
                : "object-cover opacity-30 mix-blend-overlay"
          )}
        />
      )}
      {scrim && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
      )}
      <div className="relative">
        <h3 className="font-display text-lg leading-tight font-bold sm:text-xl">
          {banner.title}
        </h3>
        {banner.subtitle && (
          <p className="mt-1 text-sm opacity-90">{banner.subtitle}</p>
        )}
      </div>
      {banner.cta_label && (
        <div className="relative mt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors group-hover:bg-white/30">
            {banner.cta_label}
            <ArrowRight className="size-3.5 rtl:-scale-x-100" />
          </span>
        </div>
      )}
    </article>
  );
  if (banner.link) {
    return (
      <Link href={banner.link} className="group block">
        {content}
      </Link>
    );
  }
  return content;
}
