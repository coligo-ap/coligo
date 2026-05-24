"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCategoryLabel } from "@/lib/config/categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { fetchMerchantsForZone } from "@/app/(customer)/actions";
import { MerchantCard } from "@/components/customer/merchant-card";
import type { PublicMerchant } from "@/lib/data/merchants-public";

// =============================================================================
// MarketplaceGrid — la grille de commerces de la home.
// =============================================================================
// La barre de recherche est gérée par `MarketplaceSearchBar` (placée en haut
// de page). Les deux composants se synchronisent via les URL params
// (q, category, sort, open_now). Ce composant relit l'URL et refetch.
//
// Le filtre `openNow` est appliqué côté client (calcul depuis opening_hours).
// La zone (wilaya/commune) vient du store local — lue séparément.
// =============================================================================

type Filters = {
  q: string;
  category: string;
  sort: "name" | "min_order";
  openNow: boolean;
};

type Props = {
  fallback: PublicMerchant[];
};

export function MarketplaceGrid({ fallback }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const loc = useCustomerLocation();

  const filters = useMemo<Filters>(
    () => ({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      sort: params.get("sort") === "min_order" ? "min_order" : "name",
      openNow: params.get("open_now") === "1",
    }),
    [params]
  );

  const [items, setItems] = useState<PublicMerchant[]>(fallback);
  const [emptyZone, setEmptyZone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (loc === null) return;
    startTransition(async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc.wilaya_code,
        commune: loc.commune,
        q: filters.q || null,
        category: filters.category || null,
        sort: filters.sort,
      });
      if (res.length === 0 && loc.wilaya_code) {
        setItems(fallback);
        setEmptyZone(true);
      } else {
        setItems(res);
        setEmptyZone(false);
      }
    });
  }, [loc, filters.q, filters.category, filters.sort, fallback]);

  const visible = useMemo(() => {
    if (!filters.openNow) return items;
    return items.filter((m) => isOpenNow(m.opening_hours));
  }, [filters.openNow, items]);

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.sort !== "name";

  function resetFilters() {
    router.replace("/", { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-base font-bold lg:text-xl">
          {emptyZone
            ? "Tous les commerces en Algérie"
            : filters.q
              ? `Résultats pour « ${filters.q} »`
              : filters.category
                ? `Catégorie : ${getCategoryLabel(filters.category)}`
                : wilayaLabel
                  ? `Commerces à ${wilayaLabel}${loc?.commune ? ` · ${loc.commune}` : ""}`
                  : "Commerces en Algérie"}
        </h2>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {emptyZone && wilayaLabel && !filters.q && !filters.category && (
        <div className="border-warning-100 bg-warning-50 text-warning-800 flex items-start gap-2 rounded-[14px] border px-3 py-2 text-xs">
          <MapPin className="text-warning-600 mt-0.5 size-3.5 shrink-0" />
          <span>
            Pas encore de commerces à <strong>{wilayaLabel}</strong> — en
            attendant, voici ceux disponibles ailleurs.
          </span>
        </div>
      )}

      {hasActiveFilter && (
        <div className="text-muted flex items-center justify-between text-xs">
          <span>
            {visible.length} commerce{visible.length > 1 ? "s" : ""} trouvé
            {visible.length > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="text-primary-700 font-medium hover:underline"
          >
            Effacer les filtres
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
          {hasActiveFilter ? (
            <>
              Aucun commerce ne correspond à ta recherche.
              <p className="mt-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-primary-700 font-medium hover:underline"
                >
                  Effacer les filtres →
                </button>
              </p>
            </>
          ) : (
            <>
              <MapPin className="text-subtle mx-auto mb-2 size-6" />
              Aucun commerce actif disponible pour le moment.
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}
    </div>
  );
}
