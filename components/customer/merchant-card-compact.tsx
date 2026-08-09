"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bike, MapPin, Percent, Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { MetaItem, MetaRow } from "@/components/customer/merchant-meta";
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
// MerchantCardCompact — variante HORIZONTALE (listes à parcourir : filtre
// Promos, résultats de recherche, favoris). MÊME jeu d'informations que
// `MerchantCard`, même discipline :
//   - vignette carrée qui remplit TOUJOURS l'espace (jamais de vignette vide) ;
//   - nom en graisse forte = seule information dominante ;
//   - UNE ligne de méta neutre : note · ouvert/fermé · mode principal · distance ;
//   - l'étiquette promo (accent rose) n'apparaît qu'UNE fois — elle était posée
//     à la fois sur la photo ET en pilule sous le nom.
// Retirés (présents sur la fiche) : ETA, ville, minimum de commande, modes
// secondaires, mention « Retrait gratuit » en vert.
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
  // même règle que merchant-card.tsx). `null` = pas encore déterminé.
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setOpen(isOpenNow(merchant.opening_hours, nowInAlgiers()));
  }, [merchant.opening_hours]);

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
  const ModeIcon = merchant.delivery_enabled ? Bike : MapPin;
  const modeLabel = merchant.delivery_enabled ? t("delivery") : t("pickup");

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className={cn(
        "group border-border bg-surface isolate flex gap-3 rounded-md border p-2.5 transition-transform active:scale-[.985]",
        open === false && "opacity-75"
      )}
    >
      {/* ─── Vignette photo (jamais vide) ─── */}
      <div
        className="border-border bg-surface-2 relative size-[92px] shrink-0 overflow-hidden rounded-sm border"
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
          <span className="bg-surface-3 text-subtle absolute inset-0 flex items-center justify-center text-3xl font-bold">
            {merchant.name.charAt(0)}
          </span>
        )}

        {/* Cœur favori (haut, côté fin) */}
        <FavoriteHeart
          merchantId={merchant.id}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          refreshOnToggle={refreshOnToggle}
          onToggled={onFavoriteToggled}
          className="absolute end-1.5 top-1.5 z-10 scale-90"
        />
      </div>

      {/* ─── Infos ─── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-foreground text-title-sm line-clamp-1 font-extrabold tracking-[-0.2px]">
          {merchant.name}
        </h3>

        {/* Note · ouvert/fermé · mode principal · distance — patron partagé
            `MetaRow`. Note = 5,0 par DÉFAUT tant qu'aucun avis. */}
        <MetaRow className="mt-1">
          <MetaItem first>
            <Star className="size-3.5 fill-current" />
            {(merchant.rating_count > 0 ? merchant.rating_avg : 5).toFixed(1)}
          </MetaItem>
          {/* Rendu UNIQUEMENT une fois l'état réel connu (post-montage). */}
          {open != null && (
            <MetaItem>
              <span
                className={cn(
                  "size-[5px] rounded-full",
                  open ? "bg-success-600" : "bg-subtle"
                )}
              />
              {open ? t("open") : t("closed")}
            </MetaItem>
          )}
          <MetaItem>
            <ModeIcon className="size-3.5" />
            {modeLabel}
          </MetaItem>
          {distLabel && <MetaItem>{distLabel}</MetaItem>}
        </MetaRow>

        {/* Étiquette promo — le SEUL élément coloré de la carte, et une seule
            fois (elle était doublée sur la photo). */}
        {showPromo && (
          <span className="bg-accent-50 text-accent-700 rounded-chip text-caption-lg mt-auto inline-flex max-w-full items-center gap-1.5 self-start px-2 py-1 font-bold">
            <PromoIcon className="size-3.5 shrink-0" />
            <span className="truncate">{showPromo.text}</span>
          </span>
        )}
      </div>
    </Link>
  );
}

// Mémoïsé : dans les grilles (jusqu'à 60 cartes), une frappe dans la recherche
// ou un changement de filtre re-rend le parent — les cartes dont les props
// n'ont pas changé NE se re-rendent plus (props stables, pas de callback inline).
export const MerchantCardCompact = memo(MerchantCardCompactImpl);
