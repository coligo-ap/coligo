"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Heart,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
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
// Favori : MVP local-storage (pas de table customer_favorites pour
// l'instant). Persistance DB à brancher dans un commit ultérieur.
// =============================================================================

type Props = {
  merchantId: string;
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

const FAV_STORAGE_KEY = "coligo-favorites-v1";

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}
function writeFavorites(set: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify([...set]));
}

export function MerchantCompactHeader({
  merchantId,
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
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);

  // Favori local-storage MVP — pas persisté en DB pour l'instant.
  const [isFav, setIsFav] = useState(false);
  useEffect(() => {
    setIsFav(readFavorites().has(merchantId));
  }, [merchantId]);
  function toggleFav() {
    const next = readFavorites();
    if (next.has(merchantId)) next.delete(merchantId);
    else next.add(merchantId);
    writeFavorites(next);
    setIsFav(next.has(merchantId));
  }

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
  const categoryLabel = category ? getCategoryLabel(category) : null;
  const hasDescription = Boolean(description_fr || description_ar);
  const addressLine = [commune, wilaya_name].filter(Boolean).join(" · ");

  return (
    <div>
      {/* ───── COVER plate 140px (mobile) / 200px (desktop). Aucune carte
              dessus — la bande info est juste en dessous. ───── */}
      <div className="bg-surface-3 relative h-[140px] w-full overflow-hidden rounded-[16px] lg:h-[200px]">
        {heroOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroOptimized}
            alt={`Photo du commerce ${name}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/20 to-primary-700/30 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <span className="text-primary-700/70 text-5xl font-bold">
              {name.charAt(0)}
            </span>
          </div>
        )}

        {/* Bouton retour (rond blanc translucide) */}
        <Link
          href="/"
          aria-label="Retour"
          className="text-foreground absolute top-3 left-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/85 shadow-sm backdrop-blur transition-colors hover:bg-white"
        >
          <ArrowLeft className="size-4" />
        </Link>

        {/* Bouton favori (rond blanc translucide) */}
        <button
          type="button"
          onClick={toggleFav}
          aria-label={isFav ? "Retirer des favoris" : "Ajouter aux favoris"}
          aria-pressed={isFav}
          className={cn(
            "absolute top-3 right-3 z-10 inline-flex size-9 items-center justify-center rounded-full bg-white/85 shadow-sm backdrop-blur transition-all hover:bg-white active:scale-95",
            isFav ? "text-coral-500" : "text-foreground"
          )}
        >
          <Heart
            className={cn("size-4 transition-colors", isFav && "fill-current")}
          />
        </button>
      </div>

      {/* ───── BANDE D'INFOS COMPACTE — 3 lignes max sous la cover ───── */}
      <div className="mt-3 flex items-start gap-3">
        {/* Logo 54px qui chevauche LÉGÈREMENT le bas de la cover (margin négatif). */}
        <div className="-mt-7 shrink-0 lg:-mt-9">
          {logoOptimized ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoOptimized}
              alt=""
              loading="eager"
              decoding="async"
              className="size-14 rounded-2xl border-2 border-white bg-white object-cover shadow-md lg:size-16"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 flex size-14 items-center justify-center rounded-2xl border-2 border-white text-lg font-bold shadow-md lg:size-16">
              {name.charAt(0)}
            </div>
          )}
        </div>

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
            <span className="text-foreground">~{prep_time_min} min</span>
          </span>
        )}
        {min_order_da > 0 && (
          <>
            <span aria-hidden>·</span>
            <span className="text-foreground">
              Min <strong>{formatDA(min_order_da)}</strong>
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
          Horaires
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
              {expandDesc ? "Voir moins" : "Voir plus"}
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
                    ? "Fermé"
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
