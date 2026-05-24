import Link from "next/link";
import { Clock } from "lucide-react";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";
import { cn } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import type { PublicMerchant } from "@/lib/data/merchants-public";

// =============================================================================
// StoreCardCompact — carte ~248px (carrousel « Populaires près de toi »).
// =============================================================================
// Statut ouvert/fermé calculé Africa/Algiers côté serveur (cf. nowInAlgiers).
// Pas de cœur favori (système non implémenté) ni de note (système d'avis non
// implémenté) — suit l'instruction du prompt 20 (« optionnel, masque si
// absent »).
// =============================================================================

type Props = {
  merchant: PublicMerchant;
  /** Affiche un badge "PROMO" si le commerce a une promotion active. */
  hasPromo?: boolean;
};

export function StoreCardCompact({ merchant, hasPromo }: Props) {
  const open = isOpenNow(merchant.opening_hours, nowInAlgiers());
  const cover =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const logo = cldUrl(merchant.logo_url, {
    width: 72,
    height: 72,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface hover:shadow-primary-100 relative block w-[244px] shrink-0 snap-start overflow-hidden rounded-[18px] border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        "active:scale-[0.98]",
        !open && "opacity-90"
      )}
    >
      <div className="relative">
        <ImageWithOverlay
          src={cover}
          alt={merchant.name}
          variant="card"
          imgClassName="transition-transform duration-300 group-hover:scale-[1.04]"
          placeholder={
            <span className="text-primary-700/70 text-3xl font-bold">
              {merchant.name.charAt(0)}
            </span>
          }
        >
          <></>
        </ImageWithOverlay>

        {/* Badge Ouvert/Fermé (menthe quand ouvert, sombre quand fermé) */}
        <span
          className={cn(
            "absolute top-2 left-2 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur",
            open ? "bg-mint-500/95 text-white" : "bg-foreground/80 text-white"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              open ? "animate-pulse bg-white" : "bg-white/70"
            )}
          />
          {open ? "Ouvert" : "Fermé"}
        </span>

        {hasPromo && (
          <span className="bg-coral-500 absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            PROMO
          </span>
        )}
      </div>

      {/* Body */}
      <div className="relative p-3">
        {logo && (
          <div className="absolute -top-6 right-3 size-11 overflow-hidden rounded-full border-2 border-white bg-white shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <h3 className="font-display text-foreground line-clamp-1 pr-12 text-sm font-bold">
          {merchant.name}
        </h3>
        {merchant.category && (
          <p className="text-muted mt-0.5 line-clamp-1 text-xs">
            {merchant.category}
          </p>
        )}

        <div className="text-muted mt-2 flex items-center gap-3 text-[11px]">
          {merchant.prep_time_min > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              Prêt en {merchant.prep_time_min} min
            </span>
          )}
          <span className="text-mint-700 font-semibold">Retrait gratuit</span>
        </div>
      </div>
    </Link>
  );
}
