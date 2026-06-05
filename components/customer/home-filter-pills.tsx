"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bike, Star, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// HomeFilterPills — la rangée de pilules de filtres de l'accueil (style Uber
// Eats). Pilule active = noir plein. Pilotée par les URL params, comme la
// MarketplaceGrid et la barre de recherche (découplage via l'URL, pas de
// context React).
//
//  - Tous        → réinitialise les filtres mode / tri / ouvert (garde q + catégorie)
//  - 🛵 Livraison → delivery=1
//  - ⚡ Express   → delivery=1 & delivery_mode=express
//  - ★ Mieux notés → sort=rating
//  - 🟢 Ouvert    → open_now=1   (préserve l'ancien filtre "ouvert maintenant")
// =============================================================================

export function HomeFilterPills() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations("home");

  const state = useMemo(() => {
    const delivery = params.get("delivery") === "1";
    const mode = params.get("delivery_mode");
    const sort = params.get("sort");
    const open = params.get("open_now") === "1";
    const express = delivery && mode === "express";
    return {
      express,
      // "Livraison" = livraison sans mode spécifique (sinon c'est Express).
      delivery: delivery && !express,
      rating: sort === "rating",
      open,
      tous: !delivery && !open && sort !== "rating",
    };
  }, [params]);

  function apply(mut: (sp: URLSearchParams) => void) {
    const sp = new URLSearchParams(params.toString());
    mut(sp);
    const qs = sp.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  const reset = () =>
    apply((sp) => {
      sp.delete("delivery");
      sp.delete("delivery_mode");
      sp.delete("open_now");
      if (sp.get("sort") === "rating") sp.delete("sort");
    });

  const toggleDelivery = () =>
    apply((sp) => {
      if (state.delivery) {
        sp.delete("delivery");
        sp.delete("delivery_mode");
      } else {
        sp.set("delivery", "1");
        sp.delete("delivery_mode");
      }
    });

  const toggleExpress = () =>
    apply((sp) => {
      if (state.express) {
        sp.delete("delivery");
        sp.delete("delivery_mode");
      } else {
        sp.set("delivery", "1");
        sp.set("delivery_mode", "express");
      }
    });

  const toggleRating = () =>
    apply((sp) => {
      if (state.rating) sp.delete("sort");
      else sp.set("sort", "rating");
    });

  const toggleOpen = () =>
    apply((sp) => {
      if (state.open) sp.delete("open_now");
      else sp.set("open_now", "1");
    });

  return (
    <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
      <Pill active={state.tous} onClick={reset}>
        {t("filterAll")}
      </Pill>
      <Pill active={state.delivery} onClick={toggleDelivery}>
        <Bike className="size-4" strokeWidth={2} />
        {t("filterDelivery")}
      </Pill>
      <Pill active={state.express} onClick={toggleExpress}>
        <Zap className="size-4" strokeWidth={2} />
        {t("filterExpress")}
      </Pill>
      <Pill active={state.rating} onClick={toggleRating}>
        <Star
          className={cn("size-4", state.rating && "fill-current")}
          strokeWidth={2}
        />
        {t("filterTopRated")}
      </Pill>
      <Pill active={state.open} onClick={toggleOpen}>
        <span
          className={cn(
            "size-2 rounded-full",
            state.open ? "bg-success-400" : "bg-success-500"
          )}
        />
        {t("filterOpen")}
      </Pill>
    </div>
  );
}

function Pill({
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-bold transition-colors",
        active
          ? "border-foreground bg-foreground text-white"
          : "border-border bg-surface text-foreground hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
