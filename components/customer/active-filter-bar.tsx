"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bike, ListFilter, Percent, Star, X, Zap } from "lucide-react";
import { categoryLabelFrom, useCategories } from "@/lib/hooks/use-categories";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";

// =============================================================================
// ActiveFilterBar — la bande « filtre appliqué » de l'accueil, SOUS les
// catégories rondes et les pilules. Dès qu'un filtre est actif (catégorie du
// strip, promos, livraison, express, mieux notés, ouvert), une bande violette
// pâle NOMME chaque filtre en chip : le client voit d'un coup d'œil que la
// liste est filtrée et sur quoi, et retire un filtre d'un tap (✕ par chip,
// « Tout effacer » si plusieurs). La recherche (q) n'apparaît PAS ici : la
// barre de recherche l'affiche déjà (jamais de doublon d'information).
// Pilotée par les URL params, comme le strip / les pilules / la grille.
// =============================================================================

type Chip = {
  key: string;
  label: string;
  icon: React.ReactNode;
  remove: (sp: URLSearchParams) => void;
};

export function ActiveFilterBar() {
  const params = useFilterParams();
  const t = useTranslations("home");
  const locale = useLocale();
  // Libellés + emojis de catégorie pilotés en base (mig 0311).
  const dbCategories = useCategories();

  const chips = useMemo<Chip[]>(() => {
    const list: Chip[] = [];
    const category = params.get("category");
    if (category) {
      const db = dbCategories.find((c) => c.code === category);
      list.push({
        key: "category",
        // Même libellé court que la tuile du strip (1er segment).
        label: categoryLabelFrom(dbCategories, category, locale)
          .split(/[/–-]/)[0]
          .trim(),
        icon: <span aria-hidden>{db?.emoji ?? "🏷️"}</span>,
        remove: (sp) => sp.delete("category"),
      });
    }
    if (params.get("promo") === "1") {
      list.push({
        key: "promo",
        label: t("filterPromos"),
        icon: (
          <Percent className="text-accent-500 size-3.5" strokeWidth={2.5} />
        ),
        remove: (sp) => sp.delete("promo"),
      });
    }
    const delivery = params.get("delivery") === "1";
    if (delivery && params.get("delivery_mode") === "express") {
      list.push({
        key: "express",
        label: t("filterExpress"),
        icon: <Zap className="text-coral-500 size-3.5" strokeWidth={2} />,
        remove: (sp) => {
          sp.delete("delivery");
          sp.delete("delivery_mode");
        },
      });
    } else if (delivery) {
      list.push({
        key: "delivery",
        label: t("filterDelivery"),
        icon: <Bike className="text-mint-600 size-3.5" strokeWidth={2} />,
        remove: (sp) => {
          sp.delete("delivery");
          sp.delete("delivery_mode");
        },
      });
    }
    if (params.get("sort") === "rating") {
      list.push({
        key: "rating",
        label: t("filterTopRated"),
        icon: (
          <Star
            className="size-3.5 fill-amber-400 text-amber-500"
            strokeWidth={2}
          />
        ),
        remove: (sp) => sp.delete("sort"),
      });
    }
    if (params.get("open_now") === "1") {
      list.push({
        key: "open",
        label: t("filterOpen"),
        icon: <span className="bg-success-500 size-2 rounded-full" />,
        remove: (sp) => sp.delete("open_now"),
      });
    }
    return list;
  }, [params, dbCategories, locale, t]);

  // « Tout effacer » = les filtres de cette barre SEULEMENT — la recherche (q)
  // appartient à la barre de recherche, on n'y touche pas.
  const clearAll = () =>
    applyFilters((sp) => {
      for (const k of [
        "category",
        "promo",
        "delivery",
        "delivery_mode",
        "open_now",
      ])
        sp.delete(k);
      if (sp.get("sort") === "rating") sp.delete("sort");
    });

  if (chips.length === 0) return null;

  return (
    <div className="bg-primary-50 scrollbar-hide mt-2 flex items-center gap-2 overflow-x-auto rounded-[14px] px-3 py-2">
      <span className="text-primary-700 flex shrink-0 items-center gap-1.5 text-[12px] font-extrabold">
        <ListFilter className="size-3.5" strokeWidth={2.5} />
        {t("activeFilters", { count: chips.length })}
      </span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => applyFilters(c.remove)}
          aria-label={t("removeFilter", { name: c.label })}
          className="bg-surface border-border text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold"
        >
          {c.icon}
          {c.label}
          <X className="text-muted size-3.5" strokeWidth={2.5} />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-primary-700 ms-auto shrink-0 text-[12px] font-bold hover:underline"
        >
          {t("clearAllFilters")}
        </button>
      )}
    </div>
  );
}
