"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bike, Clock, MapPin, Percent, Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { WILAYAS } from "@/lib/config/wilayas";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

type Props = {
  merchant: PublicMerchant;
  hasPromo?: boolean;
  promo?: PromoLabel | null;
  distanceKm?: number | null;
  initialFavorite?: boolean;
  isAuth?: boolean;
  refreshOnToggle?: boolean;
  onFavoriteToggled?: (favorite: boolean) => void;
};

// =============================================================================
// MerchantCardCompact — variante HORIZONTALE condensée (listes à parcourir :
// filtre Promos, résultats, « Voir tout »). Mêmes données que MerchantCard.
// Points clés (cf. maquette) :
//   - vignette carrée à GAUCHE qui remplit TOUJOURS l'espace (image cover +
//     fond de secours + initiale → JAMAIS de vignette vide, même si l'image
//     ne charge pas) ;
//   - badge promo posé SUR la photo (bas-gauche, rose réduction) ;
//   - cœur favori en haut-droite de la vignette ;
//   - 2 variantes : avec promo (ligne promo rose) / sans promo (modes).
// =============================================================================
function MerchantCardCompactImpl({
  merchant,
  hasPromo,
  promo,
  distanceKm,
  initialFavorite = false,
  isAuth = false,
  refreshOnToggle = false,
  onFavoriteToggled,
}: Props) {
  const t = useTranslations("listing");
  const showPromo =
    promo ??
    (hasPromo ? { text: t("promo"), kind: "discount" as const } : null);
  // Ouvert/fermé dépend de l'HEURE COURANTE → calculé APRÈS montage pour que
  // le HTML serveur et la 1ʳᵉ hydratation soient identiques (sinon mismatch
  // React #418 quand une frontière d'horaire est franchie entre les deux —
  // même règle que merchant-card.tsx). `null` = pas encore déterminé : on
  // rend l'état « ouvert » neutre (pas de grisage, pas de badge erroné).
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setOpen(isOpenNow(merchant.opening_hours, nowInAlgiers()));
  }, [merchant.opening_hours]);

  const wilayaName = merchant.wilaya_code
    ? WILAYAS.find((w) => w.code === merchant.wilaya_code)?.name
    : null;
  const cityLabel = merchant.commune || wilayaName || null;

  const coverSrc =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const thumb = cldUrl(coverSrc, {
    width: 200,
    height: 200,
    crop: "fill",
    gravity: "auto",
  });

  const distLabel =
    distanceKm != null && distanceKm >= 0
      ? `${distanceKm.toFixed(1).replace(".", ",")} km`
      : null;

  const PromoIcon = showPromo?.kind === "discount" ? Percent : Tag;

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface isolate flex gap-3 rounded-[12px] border p-2.5 shadow-[0_1px_3px_rgba(20,20,50,0.05)] transition-transform active:scale-[.985]",
        open === false && "opacity-60"
      )}
    >
      {/* ─── Vignette photo (jamais vide) ─── */}
      <div
        className="border-border bg-surface-2 relative size-[100px] shrink-0 overflow-hidden rounded-[8px] border"
        style={
          thumb
            ? {
                backgroundImage: `url('${thumb}')`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {/* Fond de secours : initiale si aucune image (la vignette reste pleine). */}
        {!thumb && (
          <span className="bg-primary-50 text-primary-700/70 absolute inset-0 flex items-center justify-center text-3xl font-black">
            {merchant.name.charAt(0)}
          </span>
        )}
        {/* Voile bas pour lisibilité du badge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25"
        />

        {/* Badge promo sur la photo (bas-gauche, rose) */}
        {showPromo && (
          <span className="from-accent-500 to-accent-600 absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-[9px] bg-gradient-to-br px-2 py-1 text-[11px] font-black text-white shadow-[0_4px_10px_rgba(230,0,122,.5)]">
            <PromoIcon className="size-3" strokeWidth={2.5} />
            {showPromo.text}
          </span>
        )}

        {/* Cœur favori (haut-droite) */}
        <FavoriteHeart
          merchantId={merchant.id}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          refreshOnToggle={refreshOnToggle}
          onToggled={onFavoriteToggled}
          className="absolute top-1.5 right-1.5 z-10 scale-90"
        />
      </div>

      {/* ─── Infos à droite ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-foreground line-clamp-1 text-[15.5px] font-extrabold tracking-[-0.3px]">
            {merchant.name}
          </h3>
          {/* Note : 5,0 par DÉFAUT tant qu'aucun avis. */}
          <span className="bg-surface-2 text-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-extrabold">
            <Star className="size-3 fill-amber-400 text-amber-500" />
            {(merchant.rating_count > 0 ? merchant.rating_avg : 5).toFixed(1)}
          </span>
        </div>

        {/* Ligne promo (rose) OU modes (sans promo) */}
        {showPromo ? (
          <span className="bg-accent-50 text-accent-700 mt-1.5 inline-flex max-w-full items-center gap-1.5 self-start rounded-[9px] px-2.5 py-1.5 text-[11.5px] font-extrabold">
            <PromoIcon className="text-accent-500 size-3.5 shrink-0" />
            <span className="truncate">{showPromo.text}</span>
          </span>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {merchant.delivery_enabled && (
              <span className="bg-primary-50 text-primary-700 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold">
                <Bike className="size-3" />
                {t("delivery")}
              </span>
            )}
            <span className="bg-surface-2 text-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold">
              <MapPin className="size-3" />
              {t("pickup")}
            </span>
          </div>
        )}

        {/* Meta : ouvert/fermé · ETA · retrait gratuit / distance */}
        <div className="text-muted mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-2 text-[12px] font-bold">
          {/* Badge rendu UNIQUEMENT une fois l'état réel connu (post-montage). */}
          {open != null && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                open ? "text-success-700" : "text-muted"
              )}
            >
              <span
                className={cn(
                  "size-[6px] rounded-full",
                  open ? "bg-success-600" : "bg-subtle"
                )}
              />
              {open ? t("open") : t("closed")}
            </span>
          )}
          {merchant.prep_time_min > 0 && (
            <>
              <Dot />
              <span className="text-muted inline-flex items-center gap-1">
                <Clock className="size-3" />
                {merchant.prep_time_min} min
              </span>
            </>
          )}
          {distLabel ? (
            <>
              <Dot />
              <span className="text-muted">{distLabel}</span>
            </>
          ) : (
            <>
              <Dot />
              <span className="text-success-700 inline-flex items-center gap-1 whitespace-nowrap">
                <MapPin className="size-3 shrink-0" />
                {t("freePickup")}
              </span>
            </>
          )}
          {!distLabel && cityLabel && (
            <>
              <Dot />
              <span className="text-muted">{cityLabel}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

function Dot() {
  return <span className="bg-subtle size-[3px] rounded-full" aria-hidden />;
}

// Mémoïsé : dans les grilles (jusqu'à 60 cartes), une frappe dans la recherche
// ou un changement de filtre re-rend le parent — les cartes dont les props
// n'ont pas changé NE se re-rendent plus (props stables, pas de callback inline).
export const MerchantCardCompact = memo(MerchantCardCompactImpl);
