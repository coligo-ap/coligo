"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/customer/rating-stars";
import { Portal } from "@/components/ui/portal";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantReviewsDialog — bouton rating cliquable + modale "Retours clients".
// =============================================================================
// Cliquer sur le rating dans la card hero ouvre une modale qui liste les
// avis (même contenu que l'ancienne section bottom). Plus accessible pour
// le client (en haut de la fiche, en 1 clic) et garde la page propre.
// =============================================================================

type Props = {
  ratingAvg: number;
  ratingCount: number;
  reviews: ReviewWithCustomer[];
  /** "stat" = colonne de la rangée d'infos Bolt (★ valeur / « (n) » dessous) ;
   *  "chip" = pastille ; défaut = colonne alignée à droite (héritage). */
  variant?: "column" | "chip" | "stat";
};

const CHIP_CLS =
  "border-border bg-surface inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-label-lg font-bold whitespace-nowrap transition-transform active:scale-[0.96]";

export function MerchantReviewsDialog({
  ratingAvg,
  ratingCount,
  reviews,
  variant = "column",
}: Props) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("reviews");

  // Aucun avis → note 5,0 par DÉFAUT + libellé « Nouveau ». Tous les commerçants
  // affichent ainsi 5 étoiles tant qu'ils n'ont pas reçu de vrai avis. Statique
  // (non cliquable : pas d'avis à lister).
  if (ratingCount === 0) {
    if (variant === "stat") {
      return (
        <span className="flex flex-col items-center gap-0.5">
          <span className="text-foreground text-title-sm inline-flex items-center gap-1 font-extrabold tabular-nums">
            <Star className="size-4 fill-amber-400 text-amber-400" />
            5.0
          </span>
          <span className="text-muted text-label font-medium">
            {t("newMerchant")}
          </span>
        </span>
      );
    }
    if (variant === "chip") {
      return (
        <span className={CHIP_CLS}>
          <Star className="size-4 fill-amber-400 text-amber-400" />
          <span className="text-foreground tabular-nums">5.0</span>
          <span className="text-muted font-medium">{t("newMerchant")}</span>
        </span>
      );
    }
    return (
      <span className="flex flex-col items-end leading-tight">
        <span className="inline-flex items-center gap-1">
          <Star className="size-4 fill-amber-400 text-amber-400" />
          <span className="text-foreground text-sm font-bold tabular-nums">
            5.0
          </span>
        </span>
        <span className="text-muted text-caption mt-0.5 font-medium">
          {t("newMerchant")}
        </span>
      </span>
    );
  }

  return (
    <>
      {variant === "stat" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-0.5 transition-opacity active:opacity-70"
          aria-label={t("ratingAriaLabel", {
            count: ratingCount,
            rating: ratingAvg.toFixed(1),
          })}
        >
          <span className="text-foreground text-title-sm inline-flex items-center gap-1 font-extrabold tabular-nums">
            <Star className="size-4 fill-amber-400 text-amber-400" />
            {ratingAvg.toFixed(1)}
          </span>
          <span className="text-muted text-label font-medium tabular-nums">
            ({ratingCount})
          </span>
        </button>
      ) : variant === "chip" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={CHIP_CLS}
          aria-label={t("ratingAriaLabel", {
            count: ratingCount,
            rating: ratingAvg.toFixed(1),
          })}
        >
          <Star className="size-4 fill-amber-400 text-amber-400" />
          <span className="text-foreground tabular-nums">
            {ratingAvg.toFixed(1)}
          </span>
          <span className="text-muted font-medium">
            {t("reviewsCount", { count: ratingCount })}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-col items-end leading-tight transition-opacity active:opacity-70"
          aria-label={t("ratingAriaLabel", {
            count: ratingCount,
            rating: ratingAvg.toFixed(1),
          })}
        >
          <span className="inline-flex items-center gap-1">
            <Star className="size-4 fill-amber-400 text-amber-400" />
            <span className="text-foreground text-sm font-bold tabular-nums">
              {ratingAvg.toFixed(1)}
            </span>
          </span>
          <span className="text-muted text-caption mt-0.5 font-medium">
            {t("reviewsCount", { count: ratingCount })}
          </span>
        </button>
      )}

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="bg-surface flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-xl">
              <header className="border-border bg-surface flex items-start justify-between gap-3 rounded-t-xl border-b px-5 py-4 sm:rounded-t-xl">
                <div>
                  <h2 className="font-display text-foreground text-lg font-bold">
                    {t("customerFeedback")}
                  </h2>
                  <div className="mt-1">
                    <RatingStars
                      avg={ratingAvg}
                      count={ratingCount}
                      size="md"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-muted hover:bg-surface-2 rounded-full p-1.5"
                  aria-label={t("close")}
                >
                  <X className="size-5" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {reviews.length === 0 ? (
                  <p className="text-muted text-sm">{t("noWrittenComment")}</p>
                ) : (
                  <ul className="space-y-3">
                    {reviews.map((r) => (
                      <ReviewItem key={r.id} review={r} t={t} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

function ReviewItem({
  review,
  t,
}: {
  review: ReviewWithCustomer;
  t: ReturnType<typeof useTranslations>;
}) {
  const displayName = anonymize(review.customer_name, t("anonymousCustomer"));
  const date = new Date(review.created_at).toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
  return (
    <li className="border-border bg-surface-2 rounded-md border p-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-foreground text-sm font-semibold">{displayName}</p>
          <p className="text-muted text-xs">
            {date}
            {review.edited_at && (
              <span className="text-subtle"> · {t("edited")}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={cn(
                "size-3.5",
                n <= review.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-border-strong fill-transparent"
              )}
            />
          ))}
        </div>
      </header>
      {review.comment && (
        <p className="text-foreground mt-2 text-sm leading-relaxed">
          {review.comment}
        </p>
      )}
    </li>
  );
}

function anonymize(fullName: string | null, fallback: string): string {
  if (!fullName) return fallback;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
