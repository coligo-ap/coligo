"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";
import { getTagLabel } from "@/lib/config/merchant-tags";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { totalUnits, useCart } from "@/lib/customer/cart-store";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantCompactHeader — en-tête fiche commerçant, refonte « ULTRA » immersive.
// =============================================================================
//   ┌───────────────────────────────────────────────┐
//   │  topbar fixe (← retour · ♡ · 🛒) translucide    │  ← devient verre dépoli
//   │  ┌─────────────────────────────────────────┐   │     + nom au scroll
//   │  │   COVER plein-cadre · dégradé sombre haut │   │
//   │  │   Nom de la boutique (posé sur la photo)  │   │
//   │  └─────────────────────────────────────────┘   │
//   └───────────────────────────────────────────────┘
//   [logo]   ●Ouvert   ★4.5 (28)            ← chevauche le bas du hero
//   Type · Commune, Wilaya                  ← zone blanche
//   ⏱ ~15 min · Min 500 DA · 📍Retrait gratuit · Horaires⌄
//   [ tags · description repliable · horaires repliables ]
//
// Le hero plonge sous l'encoche (env(safe-area-inset-top)) ; le dégradé sombre
// du haut garantit la lisibilité de la barre système et des boutons.
// =============================================================================

type Props = {
  merchantId: string;
  initialFavorite?: boolean;
  isAuth?: boolean;
  name: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  cover_url: string | null;
  logo_url: string | null;
  commune: string | null;
  wilaya_name: string | null;
  min_order_da: number;
  prep_time_min: number;
  opening_hours: OpeningHours;
  rating_avg: number;
  rating_count: number;
  reviews: ReviewWithCustomer[];
  /** Sous-spécialités (volet 1) — affichées en pilules. */
  tags?: string[];
};

export function MerchantCompactHeader({
  merchantId,
  initialFavorite = false,
  isAuth = false,
  name,
  category,
  description_fr,
  description_ar,
  cover_url,
  logo_url,
  commune,
  wilaya_name,
  min_order_da,
  prep_time_min,
  opening_hours,
  rating_avg,
  rating_count,
  reviews,
  tags = [],
}: Props) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const cart = useCart();
  const cartCount = totalUnits(cart);

  // Topbar : transparente sur la photo, puis verre dépoli + nom dès qu'on
  // dépasse le hero (≈150 px). On écoute le scroll de la fenêtre.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 140);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroSrc = cover_url ?? categoryImageFor(category) ?? null;
  const heroOptimized = heroSrc
    ? (cldUrl(heroSrc, {
        width: 1200,
        height: 480,
        crop: "fill",
        gravity: "auto",
      }) ?? heroSrc)
    : null;
  const logoOptimized = cldUrl(logo_url, {
    width: 144,
    height: 144,
    crop: "fill",
    gravity: "auto",
  });
  const categoryLabel = category ? getCategoryLabel(category, locale) : null;
  const hasDescription = Boolean(description_fr || description_ar);
  const addressLine = [commune, wilaya_name].filter(Boolean).join(", ");
  const typeline = [categoryLabel, addressLine].filter(Boolean);

  // Ligne logistique compacte (sous l'identité) : délai · minimum · retrait
  // gratuit · horaires. La catégorie et le lieu remontent dans la "typeline".
  const meta: React.ReactNode[] = [];
  if (prep_time_min > 0)
    meta.push(
      <span key="prep" className="inline-flex items-center gap-1">
        <Clock className="text-primary-600 size-3.5" />
        <span className="text-foreground font-bold">
          ~{t("prepMinutes", { count: prep_time_min })}
        </span>
      </span>
    );
  if (min_order_da > 0)
    meta.push(
      <span key="min" className="text-foreground">
        {t("min")} <strong>{formatDA(min_order_da)}</strong>
      </span>
    );
  meta.push(
    <span
      key="pickup"
      className="text-success-700 inline-flex items-center gap-1"
    >
      <MapPin className="size-3.5" />
      <span className="font-bold">{t("freePickup")}</span>
    </span>
  );

  // Bouton "verre" de la topbar : translucide sur la photo, plein au scroll.
  const rb = cn(
    "relative grid size-9 place-items-center rounded-full backdrop-blur transition-colors active:scale-90",
    scrolled
      ? "bg-surface-2 text-foreground hover:bg-surface-3"
      : "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25"
  );

  return (
    <div>
      {/* ───── TOPBAR FIXE — toujours présente pour revenir / voir le panier.
              Translucide sur la photo, puis verre dépoli + nom au scroll. ───── */}
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow]",
          scrolled
            ? "border-border border-b bg-white/85 shadow-sm backdrop-blur-xl"
            : "bg-transparent"
        )}
      >
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-2 px-3 lg:px-4">
          <Link href="/" aria-label={t("back")} className={rb}>
            <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
          </Link>
          <h2
            className={cn(
              "text-foreground min-w-0 flex-1 truncate text-base font-extrabold transition-opacity",
              scrolled ? "opacity-100" : "opacity-0"
            )}
          >
            {name}
          </h2>
          <FavoriteHeart
            merchantId={merchantId}
            initialFavorite={initialFavorite}
            isAuth={isAuth}
            variant={scrolled ? "card" : "hero"}
            className={cn(
              "size-9 shrink-0",
              scrolled && "bg-surface-2 shadow-none"
            )}
          />
          <Link
            href="/cart"
            aria-label={t("viewMyCart")}
            className={cn(rb, "shrink-0")}
          >
            <ShoppingCart className="size-[18px]" />
            {cartCount > 0 && (
              <span className="bg-success-600 absolute -end-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full border-2 border-white px-0.5 text-[9px] font-extrabold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* ───── HERO immersif plein-cadre (plonge sous l'encoche). ───── */}
      <div className="bg-surface-3 relative -mx-4 -mt-4 h-[228px] w-[calc(100%+2rem)] overflow-hidden lg:-mx-6 lg:-mt-6 lg:h-[300px] lg:w-[calc(100%+3rem)]">
        {heroOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroOptimized}
            alt={t("merchantPhotoAlt", { name })}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/25 to-primary-700/35 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <span className="text-primary-700/70 text-6xl font-bold">
              {name.charAt(0)}
            </span>
          </div>
        )}
        {/* Dégradé : sombre en haut (barre système + topbar) puis fondu vers le
            fond clair de la page en bas (la couverture se fond dans le blanc). */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,8,18,.58) 0%, rgba(8,8,18,.12) 20%, transparent 44%, rgba(8,8,18,.30) 70%, rgba(8,8,18,.20) 88%, #f7f7fb 100%)",
          }}
        />
      </div>

      {/* ───── Identité : logo (chevauche la limite couverture / blanc) + NOM à
              DROITE du logo, avec le statut d'ouverture + la note juste en
              dessous (alignés au bas du logo, dans la zone blanche → lisibles). ── */}
      <div className="relative z-[1] -mt-9 flex items-end gap-3 lg:-mt-11">
        {logoOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoOptimized}
            alt=""
            loading="eager"
            decoding="async"
            className="size-[72px] shrink-0 rounded-[20px] border-[3px] border-white bg-white object-cover shadow-xl lg:size-20"
          />
        ) : (
          <div className="bg-primary-100 text-primary-700 flex size-[72px] shrink-0 items-center justify-center rounded-[20px] border-[3px] border-white text-2xl font-bold shadow-xl lg:size-20">
            {name.charAt(0)}
          </div>
        )}
        <div className="flex min-w-0 flex-1 translate-y-2.5 flex-col gap-1.5 pb-1">
          <h1 className="text-foreground line-clamp-2 text-xl leading-tight font-black tracking-tight lg:text-2xl">
            {name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <OpenStatusBadge hours={opening_hours} />
            {rating_count > 0 && (
              <MerchantReviewsDialog
                ratingAvg={rating_avg}
                ratingCount={rating_count}
                reviews={reviews}
              />
            )}
          </div>
        </div>
      </div>

      {/* ───── Type de commerce + lieu (zone blanche, jamais sur la photo). ───── */}
      {typeline.length > 0 && (
        <p className="text-muted mt-3 text-[13px] font-semibold">
          {typeline.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden> · </span>}
              <span className={i === 0 ? "text-foreground font-extrabold" : ""}>
                {item}
              </span>
            </Fragment>
          ))}
        </p>
      )}

      {/* ───── Ligne logistique (délai · minimum · retrait gratuit · horaires). ───── */}
      <div className="text-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
        {meta.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span aria-hidden className="text-subtle">
                ·
              </span>
            )}
            {item}
          </Fragment>
        ))}
        <button
          type="button"
          onClick={() => setShowHours((v) => !v)}
          aria-expanded={showHours}
          className="text-primary-700 ms-auto inline-flex items-center gap-0.5 font-bold hover:underline"
        >
          {t("hours")}
          {showHours ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>

      {/* Pilules de spécialités (tags) — situent l'offre d'un coup d'œil. */}
      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.slice(0, 8).map((code) => (
            <span
              key={code}
              className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-1 text-[11px] font-bold"
            >
              {getTagLabel(code, locale)}
            </span>
          ))}
        </div>
      )}

      {/* Description repliable (1 ligne par défaut). */}
      {hasDescription && (
        <div className="mt-2.5">
          {description_fr && (
            <p
              className={cn(
                "text-foreground text-xs",
                !expandDesc && "line-clamp-1"
              )}
            >
              {description_fr}
            </p>
          )}
          {expandDesc && description_ar && (
            <p className="text-foreground mt-1 text-xs" dir="rtl">
              {description_ar}
            </p>
          )}
          {(description_fr && description_fr.length > 80) || description_ar ? (
            <button
              type="button"
              onClick={() => setExpandDesc((v) => !v)}
              className="text-primary-700 mt-0.5 text-[11px] font-medium hover:underline"
            >
              {expandDesc ? t("seeLess") : t("seeMore")}
            </button>
          ) : null}
        </div>
      )}

      {/* Horaires détaillés repliables (fermés par défaut). */}
      {showHours && (
        <ul className="border-border bg-surface-2 mt-3 grid gap-1 rounded-[12px] border p-3 sm:grid-cols-2">
          {DAY_KEYS.map((d) => {
            const slots = opening_hours[d] ?? [];
            return (
              <li
                key={d}
                className="text-foreground flex items-center justify-between gap-2 text-xs"
              >
                <span className="font-medium">{DAY_LABELS[d].long}</span>
                <span className="text-muted tabular-nums">
                  {slots.length === 0
                    ? t("closed")
                    : slots.map((s) => `${s.open}–${s.close}`).join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
