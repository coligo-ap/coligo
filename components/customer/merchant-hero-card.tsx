"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Phone,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import type { ReviewWithCustomer } from "@/lib/data/reviews";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";

/**
 * Carte de présentation COMPACTE du commerçant, sur la fiche /m/[slug].
 *
 * Composition (corrigée — plus de chevauchement titre/logo) :
 *   ┌─────────────────────────────────────┐
 *   │  COVER (photo, overlay décoratif)   │  ← juste un dégradé doux,
 *   │                                     │    PAS de texte (évite que la
 *   │                                     │    carte qui chevauche le masque)
 *   └─────────────────────────────────────┘
 *      ┌──────────────────────────────────┐
 *      │  [logo]  Titre du commerce       │  ← carte qui chevauche -mt-10
 *      │          Catégorie · 🟢 Ouvert   │
 *      │  ──────────────────────────────  │
 *      │  Description (2 lignes max)      │
 *      │  📍 adresse · 📞 tél · min · prep │
 *      │  ▼ Voir les horaires             │
 *      └──────────────────────────────────┘
 */
export function MerchantHeroCard({
  name,
  category,
  description_fr,
  description_ar,
  cover_url,
  logo_url,
  address,
  commune,
  wilaya_name,
  phone_public,
  min_order_da,
  prep_time_min,
  opening_hours,
  rating_avg,
  rating_count,
  reviews,
}: {
  name: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  cover_url: string | null;
  logo_url: string | null;
  address: string | null;
  commune: string | null;
  wilaya_name: string | null;
  phone_public: string | null;
  min_order_da: number;
  prep_time_min: number;
  opening_hours: OpeningHours;
  rating_avg: number;
  rating_count: number;
  reviews: ReviewWithCustomer[];
}) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);

  const addressLine =
    [address, commune, wilaya_name].filter(Boolean).join(" · ") || null;
  const hasDescription = Boolean(description_fr || description_ar);
  const heroSrc = cover_url ?? categoryImageFor(category) ?? null;
  const logoOptimized = cldUrl(logo_url, {
    width: 192,
    height: 192,
    crop: "fill",
    gravity: "auto",
  });
  // Si `category` est un CODE (boulangerie, superette, …), on l'humanise.
  const categoryLabel = category ? getCategoryLabel(category, locale) : null;

  return (
    <div>
      {/* Cover hero — overlay décoratif léger pour la profondeur visuelle.
          PAS de texte ici : la carte info qui chevauche masquerait le bas. */}
      <ImageWithOverlay
        src={heroSrc}
        alt={t("merchantPhotoAlt", { name })}
        variant="hero"
        aspectClassName="aspect-[3/1]"
        priority
        className="rounded-[20px]"
        placeholder={
          <span className="text-primary-700/60 text-5xl font-bold">
            {name.charAt(0)}
          </span>
        }
      />

      {/* Carte info — chevauche légèrement le bas du hero (-mt-10).
          Padding gauche augmenté à `pl-28` pour réserver la place du logo
          qui remonte (size-20 + marge), évitant tout chevauchement texte. */}
      <div className="bg-surface border-border relative mx-3 -mt-10 rounded-[20px] border p-4 shadow-sm lg:mx-10 lg:p-5">
        {/* Logo flottant, positionné absolument pour libérer le flux du texte. */}
        <div className="absolute -top-12 left-4 lg:-top-16 lg:left-5">
          {logoOptimized ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoOptimized}
              alt=""
              loading="eager"
              decoding="async"
              className="size-20 rounded-full border-4 border-white bg-white object-cover shadow-md lg:size-24"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 flex size-20 items-center justify-center rounded-full border-4 border-white text-2xl font-bold shadow-md lg:size-24">
              {name.charAt(0)}
            </div>
          )}
        </div>

        {/* En-tête : titre + catégorie + badge ouvert. Padding-left pour ne
            jamais passer sous le logo (qui fait 80–96px de large + marge). */}
        <header className="min-h-[3rem] pl-[5.5rem] lg:min-h-[3.5rem] lg:pl-[6.5rem]">
          <h1 className="text-foreground line-clamp-2 text-xl leading-tight font-bold lg:text-2xl">
            {name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {categoryLabel && (
              <span className="text-muted text-sm">{categoryLabel}</span>
            )}
            <OpenStatusBadge hours={opening_hours} />
            {/* Badge rating cliquable → modale "Retours clients". Masqué si
                rating_count === 0 (le composant gère lui-même). */}
            <MerchantReviewsDialog
              ratingAvg={rating_avg}
              ratingCount={rating_count}
              reviews={reviews}
            />
          </div>
        </header>

        {hasDescription && (
          <div className="mt-3">
            {description_fr && (
              <p
                className={cn(
                  "text-foreground text-sm",
                  !expandDesc && "line-clamp-2"
                )}
              >
                {description_fr}
              </p>
            )}
            {expandDesc && description_ar && (
              <p className="text-foreground mt-1 text-sm" dir="rtl">
                {description_ar}
              </p>
            )}
            {(description_fr && description_fr.length > 120) ||
            description_ar ? (
              <button
                type="button"
                onClick={() => setExpandDesc((v) => !v)}
                className="text-primary-700 mt-1 text-xs font-medium hover:underline"
              >
                {expandDesc ? t("seeLess") : t("seeMore")}
              </button>
            ) : null}
          </div>
        )}

        {/* Ligne d'infos rapide : adresse · tél · min · prep */}
        <ul className="text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {addressLine && (
            <li className="inline-flex items-center gap-1">
              <MapPin className="text-primary-600 size-3.5" />
              <span className="text-foreground">{addressLine}</span>
            </li>
          )}
          {phone_public && (
            <li className="inline-flex items-center gap-1">
              <Phone className="text-primary-600 size-3.5" />
              <a
                href={`tel:${phone_public}`}
                className="text-primary-700 hover:underline"
              >
                {phone_public}
              </a>
            </li>
          )}
          {min_order_da > 0 ? (
            <li className="inline-flex items-center gap-1">
              <Wallet className="text-primary-600 size-3.5" />
              <span className="text-foreground">
                {t("min")} <strong>{formatDA(min_order_da)}</strong>
              </span>
            </li>
          ) : (
            <li className="inline-flex items-center gap-1">
              <Wallet className="text-primary-600 size-3.5" />
              <Badge tone="success">{t("noMinimum")}</Badge>
            </li>
          )}
          {prep_time_min > 0 && (
            <li className="inline-flex items-center gap-1">
              <ShoppingBag className="text-primary-600 size-3.5" />
              <span className="text-foreground">
                ~ {t("prepMinutes", { count: prep_time_min })}
              </span>
            </li>
          )}
        </ul>

        {/* Accordéon HORAIRES — fermé par défaut */}
        <div className="border-border mt-3 border-t pt-3">
          <button
            type="button"
            onClick={() => setShowHours((v) => !v)}
            aria-expanded={showHours}
            className="text-foreground hover:bg-surface-2 -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm font-medium transition-colors"
          >
            <Clock className="text-primary-600 size-4" />
            <span className="flex-1">{t("seeOpeningHours")}</span>
            {showHours ? (
              <ChevronUp className="text-muted size-4" />
            ) : (
              <ChevronDown className="text-muted size-4" />
            )}
          </button>
          {showHours && (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
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
      </div>
    </div>
  );
}
