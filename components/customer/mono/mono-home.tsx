"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { useCart, totalUnits } from "@/lib/customer/cart-store";
import { useCategories, categoryLabelFrom } from "@/lib/hooks/use-categories";
import {
  fetchMerchantsForZone,
  fetchPromoLabels,
} from "@/app/(customer)/actions";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { MonoHeader } from "@/components/customer/mono/mono-header";
import {
  MonoCategoryRail,
  type MonoCategory,
} from "@/components/customer/mono/mono-category-rail";
import {
  MonoMerchantCard,
  type MonoMerchant,
} from "@/components/customer/mono/mono-merchant-card";
import {
  MonoSection,
  MonoSectionLink,
  MonoCarousel,
} from "@/components/customer/mono/mono-section";
import { MonoBottomNav } from "@/components/customer/mono/mono-bottom-nav";

// =============================================================================
// MonoHome — l'accueil client dans la direction « bold minimalism », branché
// sur les VRAIES données (DEV uniquement).
//
// Réplique de la référence fastapp : adresse + recherche, rail de catégories
// détourées, puis des BLOCS DE SECTION alternés contenant des CARROUSELS de
// cartes commerce à 47 % de l'écran.
//
// PROMOTIONS : il n'y a plus de bandeau promo abstrait. Une promo appartient à
// un COMMERÇANT, donc elle s'affiche SUR la carte du commerçant (pilules vertes
// empilées en haut à gauche) dans une section « Offres du jour ». Le client
// cherche un commerce et veut savoir s'il est en promo — pas l'inverse.
// =============================================================================

/** Illustration détourée par catégorie (fond transparent, jamais une photo). */
const CATEGORY_ART: Record<string, string> = {
  superette: "/hub/superette.webp",
  fast_food: "/hub/fastfood.webp",
  boulangerie: "/categories/boulangerie.png",
  fruits_legumes: "/categories/superette.png",
};
/** Repli tant que le détourage de la catégorie n'existe pas : sa photo. */
const CATEGORY_PHOTO = (code: string) => `/categories/photos/${code}.jpg`;
const CATEGORY_FALLBACK = "/categories/photos/tous.jpg";

function formatFee(m: PublicMerchant): string {
  if (!m.delivery_enabled) return "Retrait";
  return m.min_order_da > 0 ? `${m.min_order_da} DA` : "Gratuit";
}

function formatEta(m: PublicMerchant): string {
  const p = Math.max(10, m.prep_time_min || 20);
  return `${p}-${p + 15} min`;
}

/** PublicMerchant → modèle d'affichage de la carte. */
function toCard(
  m: PublicMerchant,
  promo: PromoLabel | undefined,
  categoryLabel: string
): MonoMerchant {
  const system: string[] = [];
  if (!isOpenNow(m.opening_hours)) system.push("Précommande");
  return {
    slug: m.slug,
    name: m.name,
    cover: m.cover_url ?? CATEGORY_FALLBACK,
    rating: m.rating_avg || 0,
    reviews: m.rating_count || 0,
    category: categoryLabel,
    eta: formatEta(m),
    fee: formatFee(m),
    promos: promo ? [promo.text] : undefined,
    systemBadges: system.length ? system : undefined,
  };
}

export function MonoHome({
  merchants,
  categories,
  promoLabels,
}: {
  merchants: PublicMerchant[];
  categories: { name: string; count: number }[];
  promoLabels: Record<string, PromoLabel>;
}) {
  const loc = useCustomerLocation();
  const locale = useLocale();
  const dbCategories = useCategories();
  const cart = useCart();

  // Proximité : même mécanique que la grille actuelle — le SSR sert de base,
  // la position live rejoue la requête (cache TanStack, pas de flash).
  const zoneQuery = useQuery({
    queryKey: [
      "mono-home",
      loc?.wilaya_code ?? null,
      loc?.commune ?? null,
      loc?.latitude ?? null,
      loc?.longitude ?? null,
    ],
    enabled: !!loc,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc?.wilaya_code ?? null,
        commune: loc?.commune ?? null,
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
      });
      const promos = res.length
        ? await fetchPromoLabels(res.map((m) => m.id))
        : {};
      return { items: res, promos };
    },
  });

  const items = zoneQuery.data?.items ?? merchants;
  const promos = useMemo(
    () => ({ ...promoLabels, ...(zoneQuery.data?.promos ?? {}) }),
    [promoLabels, zoneQuery.data]
  );

  const rail: MonoCategory[] = useMemo(
    () =>
      categories.slice(0, 12).map((c) => ({
        code: c.name,
        label: categoryLabelFrom(dbCategories, c.name, locale)
          .split(/[/–]/)[0]
          .trim(),
        image: CATEGORY_ART[c.name] ?? CATEGORY_PHOTO(c.name),
        photo: !CATEGORY_ART[c.name],
      })),
    [categories, dbCategories, locale]
  );

  const card = (m: PublicMerchant) =>
    toCard(
      m,
      promos[m.id],
      categoryLabelFrom(dbCategories, m.category ?? "", locale)
        .split(/[/–]/)[0]
        .trim()
    );

  const withPromo = items.filter((m) => promos[m.id]).slice(0, 8);
  const popular = [...items]
    .sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0))
    .slice(0, 8);

  const zone =
    loc?.address?.trim() ||
    [loc?.commune, loc?.wilaya_code].filter(Boolean).join(", ") ||
    "Définir une adresse";

  return (
    <div
      data-theme-mono
      className="min-h-screen bg-[var(--surface-page)] pb-[calc(112px+env(safe-area-inset-bottom))]"
    >
      <MonoHeader zone={zone} cartCount={totalUnits(cart)} />

      <div className="px-4 pb-5">
        <MonoCategoryRail
          items={rail}
          onSelect={(code) => {
            window.location.href = `/?category=${encodeURIComponent(code)}`;
          }}
        />
      </div>

      <div className="flex flex-col gap-4">
        {withPromo.length > 0 && (
          <MonoSection
            tone="b"
            title="Offres du jour 🎉"
            action={
              <MonoSectionLink href="/?promo=1">Voir tout</MonoSectionLink>
            }
          >
            <MonoCarousel>
              {withPromo.map((m) => (
                <MonoMerchantCard
                  key={m.id}
                  href={`/m/${m.slug}`}
                  merchant={card(m)}
                  className="w-[47%] min-w-[168px] shrink-0"
                />
              ))}
            </MonoCarousel>
          </MonoSection>
        )}

        {popular.length > 0 && (
          <MonoSection
            tone="a"
            title="Populaires à proximité"
            subtitle="Les choix les plus populaires, à ne pas manquer !"
          >
            <MonoCarousel>
              {popular.map((m) => (
                <MonoMerchantCard
                  key={m.id}
                  href={`/m/${m.slug}`}
                  merchant={card(m)}
                  className="w-[47%] min-w-[168px] shrink-0"
                />
              ))}
            </MonoCarousel>
          </MonoSection>
        )}

        <MonoSection tone="b" title="Tous les commerces">
          <div className="flex flex-col gap-3">
            {items.slice(0, 20).map((m) => (
              <MonoMerchantCard
                key={m.id}
                href={`/m/${m.slug}`}
                merchant={card(m)}
              />
            ))}
          </div>
        </MonoSection>
      </div>

      <MonoBottomNav />
    </div>
  );
}
