"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bolt, Calendar, Loader2, MapPin, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCategoryLabel } from "@/lib/config/categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
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
};

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
  /** Filtres livraison — l'utilisateur ne voit que les commerçants qui livrent. */
  deliveryOnly: boolean;
  deliveryMode: "any" | "express" | "tour";
};

export function MarketplaceGrid({ fallback, promoIds, promoLabels }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const loc = useCustomerLocation();
  const [promos, setPromos] = useState<Record<string, PromoLabel>>(
    promoLabels ?? {}
  );

  const filters = useMemo<Filters>(
    () => ({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      sort: params.get("sort") === "min_order" ? "min_order" : "name",
      openNow: params.get("open_now") === "1",
      deliveryOnly: params.get("delivery") === "1",
      deliveryMode:
        params.get("delivery_mode") === "express"
          ? "express"
          : params.get("delivery_mode") === "tour"
            ? "tour"
            : "any",
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
        // Rafraîchit les étiquettes promo pour les commerces affichés.
        const labels = await fetchPromoLabels(res.map((m) => m.id));
        setPromos((prev) => ({ ...prev, ...labels }));
      }
    });
  }, [loc, filters.q, filters.category, filters.sort, fallback]);

  const visible = useMemo(() => {
    let base = items;
    if (filters.openNow) base = base.filter((m) => isOpenNow(m.opening_hours));
    if (filters.deliveryOnly) base = base.filter((m) => m.delivery_enabled);
    if (filters.deliveryMode === "express") {
      base = base.filter((m) => m.delivery_enabled && m.express_enabled);
    } else if (filters.deliveryMode === "tour") {
      base = base.filter((m) => m.delivery_enabled && m.tours_enabled);
    }
    // TRI : OUVERTS D'ABORD, fermés ensuite (mais cliquables, opacité réduite
    // côté carte). Cohérent avec le prompt redesign.
    return [...base].sort((a, b) => {
      const ao = isOpenNow(a.opening_hours) ? 0 : 1;
      const bo = isOpenNow(b.opening_hours) ? 0 : 1;
      return ao - bo;
    });
  }, [filters.openNow, filters.deliveryOnly, filters.deliveryMode, items]);

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.deliveryOnly ||
    filters.deliveryMode !== "any" ||
    filters.sort !== "name";

  function resetFilters() {
    router.replace("/", { scroll: false });
  }

  function setDeliveryFilter(next: {
    deliveryOnly?: boolean;
    deliveryMode?: "any" | "express" | "tour";
  }) {
    const sp = new URLSearchParams(params.toString());
    const newOnly = next.deliveryOnly ?? filters.deliveryOnly;
    const newMode = next.deliveryMode ?? filters.deliveryMode;
    if (newOnly) sp.set("delivery", "1");
    else sp.delete("delivery");
    if (newMode === "any") sp.delete("delivery_mode");
    else sp.set("delivery_mode", newMode);
    router.replace(`/?${sp.toString()}`, { scroll: false });
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

      {/* Chips filtres livraison */}
      <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1">
        <FilterChip
          icon={<Truck className="size-3.5" />}
          label="Livraison"
          active={filters.deliveryOnly && filters.deliveryMode === "any"}
          onClick={() =>
            setDeliveryFilter({
              deliveryOnly:
                !filters.deliveryOnly || filters.deliveryMode !== "any",
              deliveryMode: "any",
            })
          }
        />
        <FilterChip
          icon={<Bolt className="size-3.5" />}
          label="Express"
          active={filters.deliveryMode === "express"}
          onClick={() =>
            setDeliveryFilter({
              deliveryOnly: filters.deliveryMode !== "express",
              deliveryMode:
                filters.deliveryMode === "express" ? "any" : "express",
            })
          }
        />
        <FilterChip
          icon={<Calendar className="size-3.5" />}
          label="Tournée"
          active={filters.deliveryMode === "tour"}
          onClick={() =>
            setDeliveryFilter({
              deliveryOnly: filters.deliveryMode !== "tour",
              deliveryMode: filters.deliveryMode === "tour" ? "any" : "tour",
            })
          }
        />
      </div>

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
            <MerchantCard
              key={m.id}
              merchant={m}
              hasPromo={promoIds?.has(m.id)}
              promo={promos[m.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Chip de filtre marketplace — active/inactive avec icône + label. */
function FilterChip({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-primary-600 text-white shadow"
          : "bg-surface border-border text-muted hover:bg-surface-2 border"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
