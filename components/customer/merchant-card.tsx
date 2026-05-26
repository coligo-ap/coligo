import Link from "next/link";
import { Bolt, Calendar, Clock, MapPin, Truck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";
import { cn, formatDA } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { WILAYAS } from "@/lib/config/wilayas";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { RatingStars } from "@/components/customer/rating-stars";
import type { PublicMerchant } from "@/lib/data/merchants-public";

type Props = {
  merchant: PublicMerchant;
  /** Pourcentage de cashback (entier déjà arrondi) — null si pas affiché. */
  cashbackPct?: number | null;
  /** Affiche un badge "PROMO" si le commerce a une promotion active. */
  hasPromo?: boolean;
};

export function MerchantCard({ merchant, cashbackPct, hasPromo }: Props) {
  // Statut ouvert/fermé calculé en heure d'Alger côté serveur.
  const open = isOpenNow(merchant.opening_hours, nowInAlgiers());
  const wilayaName = merchant.wilaya_code
    ? WILAYAS.find((w) => w.code === merchant.wilaya_code)?.name
    : null;
  // Fallback : si pas de cover, on prend une image illustrative de la catégorie.
  const coverSrc =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const logoOptimized = cldUrl(merchant.logo_url, {
    width: 80,
    height: 80,
    crop: "fill",
    gravity: "auto",
  });

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface hover:shadow-primary-100 relative block overflow-hidden rounded-[18px] border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        "active:scale-[0.99]",
        !open && "opacity-90"
      )}
    >
      <div className="relative">
        <ImageWithOverlay
          src={coverSrc}
          alt={merchant.name}
          variant="card"
          imgClassName="transition-transform duration-300 group-hover:scale-[1.02]"
          placeholder={
            <span className="text-primary-700/70 text-2xl font-bold">
              {merchant.name.charAt(0)}
            </span>
          }
        >
          {/* Texte superposé sur la zone sombre du dégradé. */}
          <h3 className="line-clamp-1 text-base leading-tight font-bold drop-shadow-sm">
            {merchant.name}
          </h3>
          {merchant.category && (
            <p className="line-clamp-1 text-xs text-white/85">
              {merchant.category}
            </p>
          )}
        </ImageWithOverlay>

        {/* Statut Ouvert (menthe avec pulse) / Fermé (sombre avec heure ouv si dispo) */}
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

        {/* Badge PROMO (corail) si une promotion réelle est active */}
        {hasPromo && (
          <span className="bg-coral-500 absolute top-2 right-2 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            PROMO
          </span>
        )}

        {/* Badge Livraison (et mode si UN seul mode actif) — coin bas-gauche. */}
        {merchant.delivery_enabled && (
          <div className="absolute right-2 bottom-2 z-20 flex flex-wrap items-center gap-1">
            <span className="bg-primary-600/95 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
              <Truck className="size-3" />
              Livraison
            </span>
            {merchant.express_enabled && (
              <span className="bg-warning-500/95 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                <Bolt className="size-3" />
              </span>
            )}
            {merchant.tours_enabled && (
              <span className="bg-success-600/95 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                <Calendar className="size-3" />
              </span>
            )}
          </div>
        )}

        {!hasPromo && cashbackPct && cashbackPct > 0 && (
          <Badge
            tone="primary"
            className="absolute top-2 right-2 z-20 shadow-sm"
          >
            {cashbackPct} % cashback
          </Badge>
        )}
      </div>

      {/* Body — méta secondaire (adresse, minimum) sous l'image. */}
      <div className="relative space-y-1 p-3">
        {logoOptimized && (
          <div className="absolute -top-6 right-3 size-12 overflow-hidden rounded-full border-2 border-white bg-white shadow-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoOptimized}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="text-subtle flex flex-wrap items-center gap-x-2 gap-y-1 pr-14 text-[11px]">
          {(merchant.commune || wilayaName) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {[merchant.commune, wilayaName].filter(Boolean).join(", ")}
            </span>
          )}
          {merchant.rating_count > 0 && (
            <>
              <span aria-hidden>·</span>
              <RatingStars
                avg={merchant.rating_avg}
                count={merchant.rating_count}
                showCount
              />
            </>
          )}
          {merchant.min_order_da > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Wallet className="size-3" />
                Min {formatDA(merchant.min_order_da)}
              </span>
            </>
          )}
        </div>

        {/* Bandeau "Prêt en X min · Retrait gratuit" (menthe) */}
        <div className="mt-2 flex items-center gap-3 text-[11px]">
          {merchant.prep_time_min > 0 && (
            <span className="text-muted inline-flex items-center gap-1">
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
