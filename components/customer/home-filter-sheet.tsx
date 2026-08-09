"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Bike, Percent, SlidersHorizontal, Star, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";

// =============================================================================
// HomeFilterButton — les filtres de l'accueil, DANS la ligne de recherche.
//
// Avant : une rangée de 6 pilules empilée en permanence sous les catégories
// (`home-filter-pills.tsx`), chacune d'une couleur différente — 6 strates avant
// le premier commerce et 6 accents qui décoraient au lieu de désigner. Ici, un
// seul bouton (pastille violette quand au moins un filtre est posé) ouvre une
// feuille : la home ne montre plus que recherche · catégories · contenu.
//
// La mécanique ne change PAS : tout passe par les URL params (`applyFilters`
// → history.replaceState), donc zéro aller-retour serveur et la grille /
// la recherche restent synchronisées sans context React.
//
//  - Promos       → promo=1
//  - Livraison    → delivery=1
//  - Express      → delivery=1 & delivery_mode=express
//  - Mieux notés  → sort=rating
//  - Ouvert       → open_now=1
// =============================================================================

export function HomeFilterButton() {
  const params = useFilterParams();
  const t = useTranslations("home");
  const [open, setOpen] = useState(false);

  const state = useMemo(() => {
    const delivery = params.get("delivery") === "1";
    const mode = params.get("delivery_mode");
    const sort = params.get("sort");
    const express = delivery && mode === "express";
    return {
      promo: params.get("promo") === "1",
      express,
      // « Livraison » = livraison sans mode spécifique (sinon c'est Express).
      delivery: delivery && !express,
      rating: sort === "rating",
      openNow: params.get("open_now") === "1",
    };
  }, [params]);

  const count = Object.values(state).filter(Boolean).length;

  const reset = () =>
    applyFilters((sp) => {
      sp.delete("delivery");
      sp.delete("delivery_mode");
      sp.delete("open_now");
      sp.delete("promo");
      if (sp.get("sort") === "rating") sp.delete("sort");
    });

  const togglePromo = () =>
    applyFilters((sp) => {
      if (state.promo) sp.delete("promo");
      else sp.set("promo", "1");
    });

  const toggleDelivery = () =>
    applyFilters((sp) => {
      if (state.delivery) {
        sp.delete("delivery");
        sp.delete("delivery_mode");
      } else {
        sp.set("delivery", "1");
        sp.delete("delivery_mode");
      }
    });

  const toggleExpress = () =>
    applyFilters((sp) => {
      if (state.express) {
        sp.delete("delivery");
        sp.delete("delivery_mode");
      } else {
        sp.set("delivery", "1");
        sp.set("delivery_mode", "express");
      }
    });

  const toggleRating = () =>
    applyFilters((sp) => {
      if (state.rating) sp.delete("sort");
      else sp.set("sort", "rating");
    });

  const toggleOpen = () =>
    applyFilters((sp) => {
      if (state.openNow) sp.delete("open_now");
      else sp.set("open_now", "1");
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("filters")}
        aria-expanded={open}
        className={cn(
          "rounded-control relative grid size-[46px] shrink-0 place-items-center border transition-colors",
          count > 0
            ? "border-primary-600 bg-primary-600 text-on-brand"
            : "border-border bg-surface-2 text-foreground hover:bg-surface-3"
        )}
      >
        <SlidersHorizontal className="size-[18px]" />
        {/* Compteur : l'état « filtré » se voit sans ouvrir la feuille. */}
        {count > 0 && (
          <span className="bg-accent-500 text-on-brand text-nano absolute -end-1 -top-1 grid size-4 place-items-center rounded-full font-bold">
            {count}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("filters")}
        size="sm"
        footer={
          <div className="flex items-center gap-2">
            {count > 0 && (
              <button
                type="button"
                onClick={reset}
                className="rounded-control border-border text-foreground text-body-lg flex-1 border py-3 font-semibold"
              >
                {t("filtersReset")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-control bg-primary-600 text-on-brand text-body-lg flex-[1.4] py-3 font-semibold"
            >
              {t("filtersApply")}
            </button>
          </div>
        }
      >
        {/* Chaque filtre s'applique AU TAP (URL params) : la liste derrière est
            déjà à jour quand la feuille se ferme. */}
        <div className="flex flex-wrap gap-2">
          <FilterPill active={state.promo} onClick={togglePromo}>
            <Percent className="size-4" />
            {t("filterPromos")}
          </FilterPill>
          <FilterPill active={state.delivery} onClick={toggleDelivery}>
            <Bike className="size-4" />
            {t("filterDelivery")}
          </FilterPill>
          <FilterPill active={state.express} onClick={toggleExpress}>
            <Zap className="size-4" />
            {t("filterExpress")}
          </FilterPill>
          <FilterPill active={state.rating} onClick={toggleRating}>
            <Star className={cn("size-4", state.rating && "fill-current")} />
            {t("filterTopRated")}
          </FilterPill>
          <FilterPill active={state.openNow} onClick={toggleOpen}>
            <span
              className={cn(
                "size-2 rounded-full",
                state.openNow ? "bg-on-brand" : "bg-success-500"
              )}
            />
            {t("filterOpen")}
          </FilterPill>
        </div>
      </Sheet>
    </>
  );
}

/**
 * Pilule de filtre. UNE seule couleur d'état actif (le violet de marque) là où
 * il y en avait six : l'accent dit « ce filtre est posé », il ne colorie plus.
 */
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-body-sm inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 font-semibold transition-colors",
        active
          ? "border-primary-600 bg-primary-600 text-on-brand"
          : "border-border bg-surface text-muted hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
