"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bike, MapPin, Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { logMerchantEvent } from "@/lib/customer/reco-events";
import { trackSelectItem } from "@/lib/analytics/ecommerce";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { MetaItem, MetaRow } from "@/components/customer/merchant-meta";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

type Props = {
  merchant: PublicMerchant;
  /** Affiche un badge promo si le commerce a une promotion active. */
  hasPromo?: boolean;
  /** Détail de la meilleure promo active (− %, code, offre) — mis en avant. */
  promo?: PromoLabel | null;
  /** Distance client → commerce (km) si la position client est connue. */
  distanceKm?: number | null;
  /** Le client a-t-il déjà ce commerce en favori ? (état initial du cœur) */
  initialFavorite?: boolean;
  /** Client connecté — sinon le cœur redirige vers la connexion. */
  isAuth?: boolean;
  /** Rafraîchir la route après toggle (ex. page /favoris). */
  refreshOnToggle?: boolean;
};

/**
 * Carte commerce — grande photo puis nom + UNE ligne de méta.
 *
 * DÉGRAISSAGE (refonte accueil) : la carte portait 14 éléments simultanés
 * (photo, ouvert, cœur, promo, ETA, nom, note, « Retrait gratuit » en vert,
 * distance, ville, minimum de commande, et 3 tags de mode) — dont plusieurs
 * redondants entre le texte et les badges. Il n'en reste que ce qui sert à
 * CHOISIR : photo · ouvert/fermé · nom · note · distance · mode principal.
 * ETA, minimum de commande, ville et modes secondaires vivent sur la fiche
 * (`merchant-compact-header.tsx`) : rien n'a disparu du parcours.
 *
 * COULEUR : les badges d'information sont neutres (token --color-photo-badge,
 * lisible en clair comme en sombre) ; seul le badge PROMO garde l'accent rose.
 * La photo redevient la principale source de couleur de l'écran.
 */
function MerchantCardImpl({
  merchant,
  hasPromo,
  promo,
  distanceKm,
  initialFavorite = false,
  isAuth = false,
  refreshOnToggle = false,
}: Props) {
  const t = useTranslations("listing");
  const showPromo =
    promo ??
    (hasPromo ? { text: t("promo"), kind: "discount" as const } : null);
  // Ouvert/fermé dépend de l'HEURE COURANTE → on le calcule APRÈS montage pour
  // que le HTML serveur (SSR) et la 1ʳᵉ hydratation client soient identiques
  // (sinon mismatch d'hydratation React #418). `null` = pas encore déterminé :
  // on n'affiche le badge qu'une fois l'état réel connu (apparition immédiate),
  // sans jamais montrer un statut erroné.
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setOpen(isOpenNow(merchant.opening_hours, nowInAlgiers()));
  }, [merchant.opening_hours]);

  const coverSrc =
    merchant.cover_url ?? categoryImageFor(merchant.category) ?? null;
  const coverOptimized = cldUrl(coverSrc, {
    width: 640,
    height: 320,
    crop: "fill",
    gravity: "auto",
  });

  const distLabel =
    distanceKm != null && distanceKm >= 0
      ? `${distanceKm.toFixed(1).replace(".", ",")} km`
      : null;

  // MODE PRINCIPAL, un seul : la livraison quand elle existe, sinon le retrait
  // (toujours possible). Express / tournée sont des variantes de livraison →
  // détaillées sur la fiche, pas empilées ici.
  const ModeIcon = merchant.delivery_enabled ? Bike : MapPin;
  const modeLabel = merchant.delivery_enabled ? t("delivery") : t("pickup");

  return (
    <Link
      href={`/m/${merchant.slug}`}
      // GA4 — select_item + événement de RECO (phase 5, best-effort).
      onClick={() => {
        trackSelectItem(
          { id: merchant.id, name: merchant.name, category: merchant.category },
          "merchants_list"
        );
        logMerchantEvent(merchant.id, "click");
      }}
      // `isolate` = nouveau contexte d'empilement : les badges (z-20) restent
      // CONFINÉS dans la carte et ne passent plus AU-DESSUS du header / de la
      // barre de recherche sticky quand on scrolle.
      className={cn(
        "group isolate block active:scale-[0.99]",
        open === false && "opacity-90"
      )}
    >
      {/* ─── Photo de couverture + overlays ─── */}
      {/* Cadre façon Yassir : bordure fine autour de la photo seule, le texte
          vit dessous (couverture = bannière → cover, pas contain). Plus de
          voile dégradé sur toute l'image : les badges portent leur propre
          plaque, la photo garde ses vraies couleurs. */}
      <div className="border-border bg-surface-2 relative h-[158px] overflow-hidden rounded-md border">
        {coverOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverOptimized}
            alt={merchant.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="bg-surface-3 text-subtle flex h-full w-full items-center justify-center text-4xl font-bold">
            {merchant.name.charAt(0)}
          </div>
        )}

        {/* badge Ouvert / Fermé (haut, côté début) — affiché une fois l'état
            connu (post-montage) pour éviter tout mismatch d'hydratation
            (#418). Plaque NEUTRE : seule la pastille porte l'état. */}
        {open !== null && (
          <span className="bg-photo-badge text-photo-badge-ink text-caption rounded-chip absolute start-2.5 top-2.5 z-20 inline-flex items-center gap-1.5 px-2 py-1 font-semibold backdrop-blur">
            <span
              className={cn(
                "size-[5px] rounded-full",
                open ? "bg-success-600" : "bg-subtle"
              )}
            />
            {open ? t("open") : t("closed")}
          </span>
        )}

        {/* cœur favori (haut, côté fin) */}
        <FavoriteHeart
          merchantId={merchant.id}
          initialFavorite={initialFavorite}
          isAuth={isAuth}
          refreshOnToggle={refreshOnToggle}
          className="absolute end-2.5 top-2.5 z-20"
        />

        {/* promo (bas, côté début) — SEUL badge coloré de la carte : les codes
            couleurs promo sont volontairement saillants. */}
        {showPromo && (
          <span className="bg-accent-600 text-on-brand rounded-chip text-caption absolute start-2.5 bottom-2.5 z-20 inline-flex items-center gap-1.5 px-2 py-1 font-bold">
            <Tag className="size-3" />
            {showPromo.text}
          </span>
        )}
      </div>

      {/* ─── Nom + UNE ligne de méta ─── */}
      <div className="px-0.5 pt-2.5">
        {/* Une seule information dominante par bloc : le NOM. */}
        <h3 className="text-foreground text-title-sm line-clamp-1 font-extrabold tracking-[-0.2px]">
          {merchant.name}
        </h3>

        {/* Note · mode principal · distance — patron partagé `MetaRow` (gris
            moyen, graisse normale). Note = 5,0 par DÉFAUT tant qu'aucun avis. */}
        <MetaRow className="mt-1">
          <MetaItem first>
            <Star className="size-3.5 fill-current" />
            {(merchant.rating_count > 0 ? merchant.rating_avg : 5).toFixed(1)}
          </MetaItem>
          <MetaItem>
            <ModeIcon className="size-3.5" />
            {modeLabel}
          </MetaItem>
          {distLabel && <MetaItem>{distLabel}</MetaItem>}
        </MetaRow>
      </div>
    </Link>
  );
}

// Mémoïsé : dans la grille d'accueil (jusqu'à 60 cartes), la frappe dans la
// recherche / les filtres re-rend le parent — les cartes inchangées NE se
// re-rendent plus (props stables, aucun callback inline).
export const MerchantCard = memo(MerchantCardImpl);
