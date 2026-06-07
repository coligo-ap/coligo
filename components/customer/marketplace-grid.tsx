"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Loader2, MapPin } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCategoryLabel } from "@/lib/config/categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { haversineKm } from "@/lib/delivery/distance";
import {
  fetchMerchantsForZone,
  fetchPromoLabels,
} from "@/app/(customer)/actions";
import { MerchantCard } from "@/components/customer/merchant-card";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

type Props = {
  fallback: PublicMerchant[];
  /** IDs des commerces avec promo active — utilisé pour afficher le badge PROMO. */
  promoIds?: Set<string>;
  /** Détails des promos (− %, code, offre) par merchant_id. */
  promoLabels?: Record<string, PromoLabel>;
  /** IDs des commerces favoris du client (pour l'état initial du cœur). */
  favoriteIds?: Set<string>;
  /** Client connecté — passe au cœur favori. */
  isAuth?: boolean;
};

// =============================================================================
// MarketplaceGrid — la liste de commerces de la home (style Uber Eats).
// =============================================================================
// La recherche (q) vient de `MarketplaceSearchBar`, la catégorie des ronds
// (`CategoryStrip`), et les modes/tri/ouvert des pilules (`HomeFilterPills`).
// Les quatre se synchronisent UNIQUEMENT via les URL params. Ce composant relit
// l'URL, refetch par zone, applique les filtres client (ouvert / mode / tri).
// =============================================================================

type Filters = {
  q: string;
  category: string;
  sort: "name" | "min_order" | "rating";
  openNow: boolean;
  deliveryOnly: boolean;
  deliveryMode: "any" | "express" | "tour";
  /** Filtre « Promos » : ne garder que les commerces avec une promo active. */
  promoOnly: boolean;
};

export function MarketplaceGrid({
  fallback,
  promoIds,
  promoLabels,
  favoriteIds,
  isAuth = false,
}: Props) {
  const params = useSearchParams();
  const router = useRouter();
  const t = useTranslations("browse");
  const locale = useLocale();
  const loc = useCustomerLocation();
  const [promos, setPromos] = useState<Record<string, PromoLabel>>(
    promoLabels ?? {}
  );

  const filters = useMemo<Filters>(
    () => ({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      sort:
        params.get("sort") === "min_order"
          ? "min_order"
          : params.get("sort") === "rating"
            ? "rating"
            : "name",
      openNow: params.get("open_now") === "1",
      deliveryOnly: params.get("delivery") === "1",
      deliveryMode:
        params.get("delivery_mode") === "express"
          ? "express"
          : params.get("delivery_mode") === "tour"
            ? "tour"
            : "any",
      promoOnly: params.get("promo") === "1",
    }),
    [params]
  );

  const [items, setItems] = useState<PublicMerchant[]>(fallback);
  const [emptyZone, setEmptyZone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Un filtre SERVEUR (catégorie/recherche) impose un refetch même sans zone.
    const hasServerFilter = !!filters.q || !!filters.category;
    // Sans zone résolue ET sans filtre serveur : on garde le fallback rangé
    // côté serveur (et on y revient quand on efface un filtre).
    if (loc === null && !hasServerFilter) {
      setItems(fallback);
      setEmptyZone(false);
      return;
    }
    startTransition(async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc?.wilaya_code ?? null,
        commune: loc?.commune ?? null,
        q: filters.q || null,
        category: filters.category || null,
        // Le tri "rating" est appliqué côté client (la note n'est pas un champ
        // de tri serveur) → on demande l'ordre par défaut au serveur.
        sort: filters.sort === "min_order" ? "min_order" : "name",
      });
      // Zone choisie mais vide ET pas de filtre serveur → on propose le reste
      // de l'Algérie. Avec un filtre actif, on respecte le résultat (même vide).
      if (res.length === 0 && loc?.wilaya_code && !hasServerFilter) {
        setItems(fallback);
        setEmptyZone(true);
      } else {
        setItems(res);
        setEmptyZone(false);
        const labels = await fetchPromoLabels(res.map((m) => m.id));
        setPromos((prev) => ({ ...prev, ...labels }));
      }
    });
  }, [loc, filters.q, filters.category, filters.sort, fallback]);

  // Distance client → commerce (km) si on connaît la position du client.
  const distanceFor = useMemo(() => {
    const lat = loc?.latitude;
    const lng = loc?.longitude;
    return (m: PublicMerchant): number | null => {
      if (
        lat == null ||
        lng == null ||
        m.latitude == null ||
        m.longitude == null
      )
        return null;
      return haversineKm({ lat, lng }, { lat: m.latitude, lng: m.longitude });
    };
  }, [loc?.latitude, loc?.longitude]);

  const visible = useMemo(() => {
    let base = items;
    // Filtre « Promos » : commerces ayant une promo active (présents dans la map
    // promos, alimentée par le serveur puis par fetchPromoLabels au refetch).
    if (filters.promoOnly) base = base.filter((m) => !!promos[m.id]);
    if (filters.openNow) base = base.filter((m) => isOpenNow(m.opening_hours));
    if (filters.deliveryOnly) base = base.filter((m) => m.delivery_enabled);
    if (filters.deliveryMode === "express") {
      base = base.filter((m) => m.delivery_enabled && m.express_enabled);
    } else if (filters.deliveryMode === "tour") {
      base = base.filter((m) => m.delivery_enabled && m.tours_enabled);
    }
    const sorted = [...base];
    if (filters.sort === "rating") {
      // Mieux notés d'abord (note puis nombre d'avis), ouverts départagent.
      sorted.sort((a, b) => {
        if (b.rating_avg !== a.rating_avg) return b.rating_avg - a.rating_avg;
        if (b.rating_count !== a.rating_count)
          return b.rating_count - a.rating_count;
        return (
          (isOpenNow(a.opening_hours) ? 0 : 1) -
          (isOpenNow(b.opening_hours) ? 0 : 1)
        );
      });
    } else {
      // Par défaut : OUVERTS d'abord, fermés ensuite (cliquables, atténués).
      sorted.sort(
        (a, b) =>
          (isOpenNow(a.opening_hours) ? 0 : 1) -
          (isOpenNow(b.opening_hours) ? 0 : 1)
      );
    }
    return sorted;
  }, [
    filters.openNow,
    filters.deliveryOnly,
    filters.deliveryMode,
    filters.sort,
    filters.promoOnly,
    promos,
    items,
  ]);

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.deliveryOnly ||
    filters.deliveryMode !== "any" ||
    filters.promoOnly ||
    filters.sort !== "name";

  const heading = emptyZone
    ? t("allMerchantsAlgeria")
    : filters.q
      ? t("resultsFor", { query: filters.q })
      : filters.category
        ? getCategoryLabel(filters.category, locale)
        : filters.promoOnly
          ? t("promosOfTheMoment")
          : t("merchantsNearYou");

  function resetFilters() {
    router.replace("/", { scroll: false });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-foreground text-[21px] font-extrabold tracking-[-0.6px]">
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="text-muted size-4 animate-spin" />}
          <span className="bg-surface-2 grid size-8 place-items-center rounded-full">
            <ArrowRight className="text-foreground size-4 rtl:-scale-x-100" />
          </span>
        </div>
      </div>

      {emptyZone && wilayaLabel && !filters.q && !filters.category && (
        <div className="border-warning-100 bg-warning-50 text-warning-800 flex items-start gap-2 rounded-[14px] border px-3 py-2 text-xs">
          <MapPin className="text-warning-600 mt-0.5 size-3.5 shrink-0" />
          <span>
            {t.rich("noMerchantsInZone", {
              wilaya: wilayaLabel,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
        </div>
      )}

      {hasActiveFilter && (
        <div className="text-muted flex items-center justify-between text-xs">
          <span>{t("merchantsFound", { count: visible.length })}</span>
          <button
            type="button"
            onClick={resetFilters}
            className="text-primary-700 font-medium hover:underline"
          >
            {t("clearFilters")}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
          {hasActiveFilter ? (
            <>
              {t("noResults")}
              <p className="mt-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-primary-700 font-medium hover:underline"
                >
                  {t("clearFiltersArrow")}
                </button>
              </p>
            </>
          ) : (
            <>
              <MapPin className="text-subtle mx-auto mb-2 size-6" />
              {t("noActiveMerchants")}
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((m) => (
            <MerchantCard
              key={m.id}
              merchant={m}
              hasPromo={promoIds?.has(m.id)}
              promo={promos[m.id] ?? null}
              distanceKm={distanceFor(m)}
              initialFavorite={favoriteIds?.has(m.id)}
              isAuth={isAuth}
            />
          ))}
        </div>
      )}
    </div>
  );
}
