import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { RatingStars } from "@/components/customer/rating-stars";
import type { PublicMerchant } from "@/lib/data/merchants-public";

// =============================================================================
// StoreCardCompact — style Uber Eats : photo courte en haut, infos denses.
// =============================================================================
// Largeur ~180px (mobile) → 200px (desktop) : volontairement plus étroit que
// les cartes de la grille principale puisque c'est un carrousel de découverte
// rapide. Hauteur réduite par image moins haute (aspect 16:11 au lieu de 4:3).
//
// Statut Ouvert/Fermé calculé côté serveur (Africa/Algiers).
// Pas de cœur favori (système non implémenté).
// =============================================================================

type Props = {
  merchant: PublicMerchant;
  /** Si la promo active porte une étiquette courte ("-20 %"), on l'affiche
   *  au-dessus de l'image. Sinon on retombe sur le simple badge "PROMO". */
  hasPromo?: boolean;
  promoLabel?: string | null;
};

export async function StoreCardCompact({
  merchant,
  hasPromo,
  promoLabel,
}: Props) {
  const t = await getTranslations("listing");
  const open = isOpenNow(merchant.opening_hours, nowInAlgiers());
  const rawCover =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  // Cover optimisée Cloudinary (small/dense) — taille fixe = pas de jank.
  const coverOptimized = rawCover
    ? (cldUrl(rawCover, {
        width: 400,
        height: 220,
        crop: "fill",
        gravity: "auto",
      }) ?? rawCover)
    : null;

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface hover:shadow-primary-100 relative block w-[180px] shrink-0 snap-start overflow-hidden rounded-[14px] border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:w-[200px]",
        "active:scale-[0.98]",
        !open && "opacity-90"
      )}
    >
      {/* Photo courte (aspect 16:11 ≈ 180×124). */}
      <div className="bg-surface-3 relative aspect-[16/11] w-full overflow-hidden">
        {coverOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverOptimized}
            alt={merchant.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-primary-700/70 text-2xl font-bold">
              {merchant.name.charAt(0)}
            </span>
          </div>
        )}

        {/* Statut (mint pulse si ouvert) */}
        <span
          className={cn(
            "absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur",
            open ? "bg-mint-500/95 text-white" : "bg-foreground/80 text-white"
          )}
        >
          <span
            className={cn(
              "size-1 rounded-full",
              open ? "animate-pulse bg-white" : "bg-white/70"
            )}
          />
          {open ? t("open") : t("closed")}
        </span>

        {/* Badge promo — label custom si fourni, sinon "PROMO" générique. */}
        {hasPromo && (
          <span className="bg-coral-500 absolute top-1.5 right-1.5 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white shadow-sm">
            {promoLabel ?? t("promoBadge")}
          </span>
        )}
      </div>

      {/* Body dense — 2 lignes max d'infos */}
      <div className="p-2.5">
        <h3 className="font-display text-foreground line-clamp-1 text-[13px] font-bold">
          {merchant.name}
        </h3>
        <p className="text-muted mt-0.5 line-clamp-1 text-[11px]">
          {merchant.category ?? ""}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
          <RatingStars
            avg={merchant.rating_avg}
            count={merchant.rating_count}
            showCount
          />
          {merchant.prep_time_min > 0 && (
            <span className="text-muted inline-flex items-center gap-0.5">
              <Clock className="size-2.5" />
              {merchant.prep_time_min} min
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
