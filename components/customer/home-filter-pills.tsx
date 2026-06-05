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
      <Pill active={state.tous} accent="violet" onClick={reset}>
        {t("filterAll")}
      </Pill>
      <Pill active={state.delivery} accent="mint" onClick={toggleDelivery}>
        <Bike
          className={cn("size-4", !state.delivery && "text-mint-600")}
          strokeWidth={2}
        />
        {t("filterDelivery")}
      </Pill>
      <Pill active={state.express} accent="coral" onClick={toggleExpress}>
        <Zap
          className={cn("size-4", !state.express && "text-coral-500")}
          strokeWidth={2}
        />
        {t("filterExpress")}
      </Pill>
      <Pill active={state.rating} accent="amber" onClick={toggleRating}>
        <Star
          className={cn(
            "size-4",
            state.rating ? "fill-current" : "fill-amber-400 text-amber-500"
          )}
          strokeWidth={2}
        />
        {t("filterTopRated")}
      </Pill>
      <Pill active={state.open} accent="green" onClick={toggleOpen}>
        <span
          className={cn(
            "size-2 rounded-full",
            state.open ? "bg-white" : "bg-success-500"
          )}
        />
        {t("filterOpen")}
      </Pill>
    </div>
  );
}

type Accent = "violet" | "mint" | "coral" | "amber" | "green";

const ACCENT_ACTIVE: Record<Accent, string> = {
  violet: "border-primary-600 bg-primary-600 text-white",
  mint: "border-mint-600 bg-mint-600 text-white",
  coral: "border-coral-500 bg-coral-500 text-white",
  amber: "border-amber-500 bg-amber-500 text-white",
  green: "border-success-600 bg-success-600 text-white",
};

function Pill({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: Accent;
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
          ? ACCENT_ACTIVE[accent]
          : "border-border bg-surface text-foreground hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
