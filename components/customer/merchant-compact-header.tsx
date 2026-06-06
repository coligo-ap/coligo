"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ChevronDown, ChevronUp, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";
import { getTagLabel } from "@/lib/config/merchant-tags";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantCompactHeader — en-tête fiche commerçant, style Uber Eats / Glovo.
// =============================================================================
// Objectif : voir les produits vite + densité maximale d'infos utiles.
//
//   ┌─────────────────────────────────────────┐
//   │ ←   [ COVER rectangulaire plein-cadre ] ♡│  ← bords droits, plein-cadre
//   └─────────────────────────────────────────┘
//   [logo]  Nom du commerce
//           Catégorie · ★4.5 (28) · ●Ouvert · 📍Commune · ~15 min · Min 500 DA · Horaires⌄
//   [   description repliable · horaires repliables   ]
//
// Toutes les infos secondaires sont sur UNE ligne meta qui s'enroule, pour
// gagner de la hauteur. Favori persisté en DB via <FavoriteHeart>.
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

  const heroSrc = cover_url ?? categoryImageFor(category) ?? null;
  const heroOptimized = heroSrc
    ? (cldUrl(heroSrc, {
        width: 1200,
        height: 360,
        crop: "fill",
        gravity: "auto",
      }) ?? heroSrc)
    : null;
  const logoOptimized = cldUrl(logo_url, {
    width: 128,
    height: 128,
    crop: "fill",
    gravity: "auto",
  });
  const categoryLabel = category ? getCategoryLabel(category, locale) : null;
  const hasDescription = Boolean(description_fr || description_ar);
  const addressLine = [commune, wilaya_name].filter(Boolean).join(" · ");

  // Ligne meta unique : on assemble les items présents puis on les sépare par
  // des points médians (catégorie + avis côte à côte, puis logistique).
  const meta: React.ReactNode[] = [];
  if (categoryLabel) meta.push(<span key="cat">{categoryLabel}</span>);
  if (rating_count > 0)
    meta.push(
      <MerchantReviewsDialog
        key="rev"
        ratingAvg={rating_avg}
        ratingCount={rating_count}
        reviews={reviews}
      />
    );
  meta.push(<OpenStatusBadge key="open" hours={opening_hours} />);
  if (addressLine)
    meta.push(
      <span key="addr" className="inline-flex items-center gap-1">
        <MapPin className="text-primary-600 size-3" />
        <span className="text-foreground">{addressLine}</span>
      </span>
    );
  if (prep_time_min > 0)
    meta.push(
      <span key="prep" className="inline-flex items-center gap-1">
        <Clock className="text-primary-600 size-3" />
        <span className="text-foreground">
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
    <button
      key="hours"
      type="button"
      onClick={() => setShowHours((v) => !v)}
      aria-expanded={showHours}
      className="text-primary-700 inline-flex items-center gap-0.5 font-semibold hover:underline"
    >
      {t("hours")}
      {showHours ? (
        <ChevronUp className="size-3" />
      ) : (
        <ChevronDown className="size-3" />
      )}
    </button>
  );

  return (
    <div>
      {/* ───── COVER plein-cadre rectangulaire (bords droits), à ras du haut.
              `-mx`/`-mt` annulent le padding de la page pour un rendu edge-to-edge. */}
      <div className="bg-surface-3 relative -mx-4 -mt-4 h-[160px] w-[calc(100%+2rem)] lg:-mx-6 lg:-mt-6 lg:h-[240px] lg:w-[calc(100%+3rem)]">
        {heroOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroOptimized}
            alt={t("merchantPhotoAlt", { name })}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/20 to-primary-700/30 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <span className="text-primary-700/70 text-5xl font-bold">
              {name.charAt(0)}
            </span>
          </div>
        )}
        {/* Dégradé bas pour la lisibilité des boutons et du logo. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/25 to-transparent" />

        {/* Retour (haut-début) — flèche miroir en RTL. */}
        <Link
          href="/"
          aria-label={t("back")}
          className="text-foreground absolute start-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition-colors hover:bg-white"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
        </Link>

        {/* Favori (haut-fin) — persisté en DB. */}
        <FavoriteHeart
          merchantId={merchantId}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          className="absolute end-3 top-3 z-10 size-9 bg-white/90"
        />
      </div>

      {/* ───── Rangée identité : logo (chevauche la cover) + nom. ───── */}
      <div className="relative z-10 -mt-9 flex items-end gap-3 lg:-mt-11">
        {logoOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoOptimized}
            alt=""
            loading="eager"
            decoding="async"
            className="size-[72px] shrink-0 rounded-2xl border-[3px] border-white bg-white object-cover shadow-lg lg:size-20"
          />
        ) : (
          <div className="bg-primary-100 text-primary-700 flex size-[72px] shrink-0 items-center justify-center rounded-2xl border-[3px] border-white text-xl font-bold shadow-lg lg:size-20">
            {name.charAt(0)}
          </div>
        )}
        <h1 className="font-display text-foreground line-clamp-2 flex-1 pb-1 text-xl leading-tight font-bold lg:text-2xl">
          {name}
        </h1>
      </div>

      {/* ───── Ligne meta unique (catégorie · avis · ouvert · commune · délai ·
              minimum · horaires) — s'enroule pour gagner de la hauteur. ───── */}
      <div className="text-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {meta.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden>·</span>}
            {item}
          </Fragment>
        ))}
      </div>

      {/* Pilules de spécialités (tags) — situent l'offre d'un coup d'œil. */}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
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
        <div className="mt-2">
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
        <ul className="border-border bg-surface-2 mt-2 grid gap-1 rounded-[10px] border p-3 sm:grid-cols-2">
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
