"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ChevronDown, ChevronUp, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantCompactHeader — en-tête fiche commerçant, style Uber Eats / Glovo.
// =============================================================================
// PRIORITÉ ABSOLUE : voir les produits vite. Aucun bloc qui chevauche la
// photo, hauteur minimale. Toutes les infos secondaires (description,
// horaires détaillés) sont repliables.
//
// Composition :
//   ┌───────────────────────────────────┐
//   │  ← [cover 140px nette]      ♡    │  ← boutons ronds par-dessus
//   └───────────────────────────────────┘
//   [logo] Nom du commerce  · Catégorie · ● Ouvert maintenant
//          📍 Commune · 🕒 ~15 min · Horaires ⌄ · ★ 4.5 (28 avis)
//   [    horaires détaillés repliés    ]
//
// Favori : persisté en DB (table customer_favorites) via <FavoriteHeart>.
// =============================================================================

type Props = {
  merchantId: string;
  /** Le client a-t-il ce commerce en favori ? (état initial du cœur) */
  initialFavorite?: boolean;
  /** Client connecté — sinon le cœur redirige vers la connexion. */
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

  return (
    <div>
      {/* ───── COVER plate 140px (mobile) / 200px (desktop). Le LOGO est
              positionné absolument SUR la cover (chevauche par-dessus la
              photo), façon Uber Eats. ───── */}
      <div className="bg-surface-3 relative h-[140px] w-full rounded-[16px] lg:h-[200px]">
        <div className="absolute inset-0 overflow-hidden rounded-[16px]">
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
        </div>

        {/* Bouton retour (rond blanc translucide) */}
        <Link
          href="/"
          aria-label={t("back")}
          className="text-foreground absolute top-3 left-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/85 shadow-sm backdrop-blur transition-colors hover:bg-white"
        >
          <ArrowLeft className="size-4" />
        </Link>

        {/* Bouton favori (persisté en DB) */}
        <FavoriteHeart
          merchantId={merchantId}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          className="absolute top-3 right-3 z-10 size-9 bg-white/85"
        />

        {/* Logo SUPERPOSÉ sur la cover (bottom-left, dépasse de moitié au
            dessous pour rester aussi visible que possible). */}
        <div className="absolute -bottom-7 left-4 z-10 lg:-bottom-8 lg:left-5">
          {logoOptimized ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoOptimized}
              alt=""
              loading="eager"
              decoding="async"
              className="size-16 rounded-2xl border-[3px] border-white bg-white object-cover shadow-lg lg:size-20"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 flex size-16 items-center justify-center rounded-2xl border-[3px] border-white text-xl font-bold shadow-lg lg:size-20">
              {name.charAt(0)}
            </div>
          )}
        </div>
      </div>

      {/* ───── BANDE D'INFOS COMPACTE — sous la cover, décalée à droite pour
              laisser la moitié inférieure du logo respirer. ───── */}
      <div className="mt-3 flex items-start gap-3 pl-24 lg:pl-28">
        {/* Bloc texte — toute la ligne 1 sur une rangée horizontale */}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-foreground line-clamp-1 text-lg font-bold lg:text-xl">
            {name}
          </h1>
          <div className="text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {categoryLabel && <span>{categoryLabel}</span>}
            {categoryLabel && <span aria-hidden>·</span>}
            <OpenStatusBadge hours={opening_hours} />
            {rating_count > 0 && (
              <>
                <span aria-hidden>·</span>
                <MerchantReviewsDialog
                  ratingAvg={rating_avg}
                  ratingCount={rating_count}
                  reviews={reviews}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Ligne 2 : commune · prep · "Horaires ⌄" */}
      <div className="text-muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {addressLine && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="text-primary-600 size-3" />
            <span className="text-foreground">{addressLine}</span>
          </span>
        )}
        {addressLine && prep_time_min > 0 && <span aria-hidden>·</span>}
        {prep_time_min > 0 && (
          <span className="inline-flex items-center gap-1">
            <Clock className="text-primary-600 size-3" />
            <span className="text-foreground">
              ~{t("prepMinutes", { count: prep_time_min })}
            </span>
          </span>
        )}
        {min_order_da > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="text-foreground">
              {t("min")} <strong>{formatDA(min_order_da)}</strong>
            </span>
          </>
        )}
        <span aria-hidden>·</span>
        <button
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
      </div>

      {/* Description (1 ligne, "Voir plus" pour étendre) */}
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

      {/* Horaires repliables (fermé par défaut) */}
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
