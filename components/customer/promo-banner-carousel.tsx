"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PromoBanner } from "@/lib/data/promo-banners";
import { MerchantOfferSheet } from "@/components/customer/merchant-offer-sheet";
import {
  BannerCard,
  PromoStyles,
} from "@/components/customer/promo-banner-templates";

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
      <PromoStyles />
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
  // Offre commerçant : le clic ouvre la pop-up (détails de l'offre) — INCHANGÉ.
  // Toute la carte est UN SEUL bouton (aucun élément interactif imbriqué → pas
  // de piège d'hydratation). Le visuel (modèle par type de promo) vit dans
  // BannerCard.
  if (banner.offer) {
    return (
      <OfferBanner banner={banner}>
        <BannerCard banner={banner} />
      </OfferBanner>
    );
  }
  if (banner.link) {
    return (
      <Link href={banner.link} className="group block">
        <BannerCard banner={banner} />
      </Link>
    );
  }
  return <BannerCard banner={banner} />;
}

function OfferBanner({
  banner,
  children,
}: {
  banner: PromoBanner;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!banner.offer) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full text-start"
      >
        {children}
      </button>
      <MerchantOfferSheet
        offer={banner.offer}
        headline={banner.title}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
