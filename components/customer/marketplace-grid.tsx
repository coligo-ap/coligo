"use client";

import { useMemo } from "react";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Loader2, MapPin } from "lucide-react";
import {
  openLocationPicker,
  useCustomerLocation,
} from "@/lib/customer/location-store";
import { categoryLabelFrom, useCategories } from "@/lib/hooks/use-categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { haversineKm } from "@/lib/delivery/distance";
import {
  fetchMerchantsForZone,
  fetchPromoLabels,
} from "@/app/(customer)/actions";
import { MerchantCard } from "@/components/customer/merchant-card";
import { MerchantCardCompact } from "@/components/customer/merchant-card-compact";
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
  /**
   * Ranking unifié actif (mig 0261) : l'ordre par défaut vient du score
   * composite calculé côté serveur (proximité FORTE + note/popularité/promo/
   * favoris, ouverts d'abord). La grille le PRÉSERVE au lieu de re-trier par
   * distance pure. Les tris explicites (mieux notés / prix) restent prioritaires.
   */
  unified?: boolean;
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
  unified = false,
}: Props) {
  const params = useFilterParams();
  const t = useTranslations("browse");
  const locale = useLocale();
  const loc = useCustomerLocation();
  // Libellés de catégorie pilotés en base (nouvelles catégories/renommages).
  const dbCategories = useCategories();
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

  // Un filtre SERVEUR (catégorie/recherche) impose un fetch même sans zone.
  const hasServerFilter = !!filters.q || !!filters.category;
  // Sans zone résolue ET sans filtre serveur : on garde le fallback rangé côté
  // serveur (AUCUNE requête) → l'accueil par défaut s'affiche sans re-fetch.
  const shouldFetch = loc !== null || hasServerFilter;
  // Le tri "rating" est appliqué côté client (la note n'est pas un champ de tri
  // serveur) → on demande l'ordre par défaut au serveur.
  const serverSort = filters.sort === "min_order" ? "min_order" : "name";

  // Grille commerces via TanStack Query : la clé = zone + filtres serveur. Tant
  // qu'elle ne change pas, le résultat est RÉUTILISÉ entre navigations
  // (staleTime 60 s) → fini le double-fetch (RSC + client) à chaque retour sur
  // l'accueil. `keepPreviousData` garde l'ancienne liste visible pendant qu'un
  // nouveau filtre charge (pas de flash vide). Le fallback SSR sert tant qu'on
  // n'a ni zone ni filtre (aucune requête réseau).
  const zoneQuery = useQuery({
    queryKey: [
      "home-merchants",
      loc?.wilaya_code ?? null,
      loc?.commune ?? null,
      loc?.latitude ?? null,
      loc?.longitude ?? null,
      filters.q || null,
      filters.category || null,
      serverSort,
    ],
    queryFn: async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc?.wilaya_code ?? null,
        commune: loc?.commune ?? null,
        // Position COURANTE → classement par proximité réelle côté serveur.
        latitude: loc?.latitude ?? null,
        longitude: loc?.longitude ?? null,
        q: filters.q || null,
        category: filters.category || null,
        sort: serverSort,
      });
      // Zone vide → liste vide assumée : la grille affiche « Aucun commerçant
      // disponible dans votre zone » + le sélecteur de position (brief §3) —
      // plus de bascule silencieuse sur le reste de l'Algérie.
      const promos = res.length
        ? await fetchPromoLabels(res.map((m) => m.id))
        : ({} as Record<string, PromoLabel>);
      return { items: res, promos };
    },
    enabled: shouldFetch,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  // PREMIER chargement de la zone (aucune donnée encore, pas d'erreur) : on ne
  // montre JAMAIS le fallback à la place — il liste d'AUTRES villes (ex. un
  // commerce à 123 km sous « Commerces près de toi ») pendant que la vraie
  // liste charge → l'utilisateur croit que SA ville n'a aucun commerce.
  // → squelettes le temps du fetch ; le fallback ne sert qu'en cas d'ÉCHEC
  // réseau avéré (mieux que rien).
  const zoneLoading = shouldFetch && !zoneQuery.data && !zoneQuery.isError;
  const items = !shouldFetch
    ? fallback
    : (zoneQuery.data?.items ?? (zoneQuery.isError ? fallback : []));
  const pending = shouldFetch && zoneQuery.isFetching;
  // Promos : celles du SSR + celles ramenées par le fetch de zone.
  const promos = useMemo<Record<string, PromoLabel>>(
    () => ({ ...(promoLabels ?? {}), ...(zoneQuery.data?.promos ?? {}) }),
    [promoLabels, zoneQuery.data]
  );

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
    const openRank = (m: PublicMerchant) =>
      isOpenNow(m.opening_hours) ? 0 : 1;
    if (filters.sort === "rating") {
      // Mieux notés d'abord (note puis nombre d'avis), ouverts départagent.
      sorted.sort((a, b) => {
        if (b.rating_avg !== a.rating_avg) return b.rating_avg - a.rating_avg;
        if (b.rating_count !== a.rating_count)
          return b.rating_count - a.rating_count;
        return openRank(a) - openRank(b);
      });
    } else if (filters.sort === "min_order") {
      // Prix minimum imposé par l'utilisateur : on respecte l'ordre serveur
      // (min_order croissant), ouverts d'abord.
      sorted.sort((a, b) => openRank(a) - openRank(b));
    } else if (unified) {
      // RANKING UNIFIÉ : l'ordre vient du score composite SERVEUR (proximité
      // forte + note/popularité/promo/favoris, ouverts d'abord). On le PRÉSERVE
      // — les filtres ci-dessus ne font que retirer des éléments, pas réordonner.
      // Re-trier par distance ici ANNULERAIT le score → surtout pas.
    } else {
      // PAR DÉFAUT (legacy) : les plus PROCHES d'abord (critère géographique
      // principal), ouverts avant fermés. Si la position n'est pas connue, on
      // garde l'ordre serveur (déjà classé : proximité si GPS, sinon qualité).
      sorted.sort((a, b) => {
        if (openRank(a) !== openRank(b)) return openRank(a) - openRank(b);
        const da = distanceFor(a);
        const db = distanceFor(b);
        if (da != null && db != null) return da - db;
        if (da != null) return -1;
        if (db != null) return 1;
        return 0;
      });
    }
    // RÈGLE PRODUIT (toutes branches, recherche texte et mode unifié compris) :
    // les commerces FERMÉS restent AFFICHÉS mais toujours EN BAS de la liste.
    // Partition STABLE : l'ordre interne de chaque groupe (pertinence, score,
    // note, distance…) est préservé — on ne fait que descendre les fermés.
    return sorted
      .map((m, i) => ({ m, i, rank: openRank(m) }))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
      .map((s) => s.m);
  }, [
    filters.openNow,
    filters.deliveryOnly,
    filters.deliveryMode,
    filters.sort,
    filters.promoOnly,
    promos,
    items,
    distanceFor,
    unified,
  ]);

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.deliveryOnly ||
    filters.deliveryMode !== "any" ||
    filters.promoOnly ||
    filters.sort !== "name";

  const heading = filters.q
    ? t("resultsFor", { query: filters.q })
    : filters.category
      ? categoryLabelFrom(dbCategories, filters.category, locale)
      : filters.promoOnly
        ? t("promosOfTheMoment")
        : t("merchantsNearYou");

  function resetFilters() {
    // Efface TOUS les filtres via le store (history.replaceState) — sinon
    // router.replace("/") est un no-op : Next croit être déjà sur "/" car le
    // store a changé l'URL hors de son routeur.
    applyFilters((sp) => {
      for (const k of [...sp.keys()]) sp.delete(k);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-foreground text-display-sm font-extrabold tracking-[-0.6px]">
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="text-muted size-4 animate-spin" />}
          <span className="bg-surface-2 grid size-8 place-items-center rounded-full">
            <ArrowRight className="text-foreground size-4 rtl:-scale-x-100" />
          </span>
        </div>
      </div>

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

      {zoneLoading ? (
        /* Premier chargement de la zone : squelettes (jamais la liste d'une
           autre ville pendant que la vraie liste arrive). */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-surface-3 h-[150px] rounded-lg" />
              <div className="bg-surface-3 mt-2.5 h-4 w-2/3 rounded" />
              <div className="bg-surface-3 mt-1.5 h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        hasActiveFilter ? (
          <div className="border-border bg-surface text-muted rounded-lg border px-6 py-12 text-center text-sm">
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
          </div>
        ) : loc && (loc.latitude != null || loc.wilaya_code) ? (
          /* Position connue mais AUCUN commerce dans le rayon : message clair +
             BOUTON qui ouvre la MÊME feuille de position que le header (jamais
             de LocationPicker incrusté ici — une seule UX de changement de
             zone). Le refetch efface cet état dès qu'une zone servie est
             choisie. */
          <div className="border-border bg-surface rounded-lg border px-6 py-8 text-center text-sm">
            <MapPin className="text-subtle mx-auto mb-2 size-6" />
            <p className="text-foreground font-extrabold">
              {t("noMerchantsYourZone")}
            </p>
            <button
              type="button"
              onClick={openLocationPicker}
              className="text-primary-700 mt-2 text-xs font-semibold hover:underline"
            >
              {t("noMerchantsYourZoneSub")}
            </button>
          </div>
        ) : (
          <div className="border-border bg-surface text-muted rounded-lg border px-6 py-12 text-center text-sm">
            <MapPin className="text-subtle mx-auto mb-2 size-6" />
            {t("noActiveMerchants")}
          </div>
        )
      ) : filters.promoOnly || !!filters.q ? (
        // Listes à PARCOURIR (Promos, résultats de recherche) : cartes COMPACTES
        // (vignette + ligne promo / modes), façon Uber Eats / Glovo. La grande
        // carte photo reste pour l'accueil « Commerces près de toi » + catégories.
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((m) => (
            <MerchantCardCompact
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
