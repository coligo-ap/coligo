"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCategories } from "@/lib/hooks/use-categories";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";
import { cn } from "@/lib/utils";

// =============================================================================
// CategoryFamilyPills — la rangée de sous-filtres d'un UNIVERS (mig 0463).
//
// Les tuiles de l'accueil ouvrent une FAMILLE (« Fast-food & Restaurants »,
// « Supérette & Alimentation ») : on arrive donc sur une liste déjà filtrée, et
// cette rangée permet de la resserrer sans quitter l'univers — Burgers · Pizza ·
// Tacos · Sandwichs · Poulet · Bowls, ou Supérette · Fruits & Légumes ·
// Boulangerie · Boucherie. Rien ne s'affiche hors d'une famille : sur l'accueil
// normal, le strip de catégories suffit.
//
// Pilotée par l'URL param `category`, comme le strip et la grille (mise à jour
// par history.replaceState → zéro aller-retour serveur).
// =============================================================================

/** Libellé court : « Supérette / Épicerie » → « Supérette ». */
function shortLabel(full: string): string {
  return full.split(/[/–]/)[0].trim() || full;
}

export function CategoryFamilyPills() {
  const params = useFilterParams();
  const active = params.get("category");
  const locale = useLocale();
  const t = useTranslations("browse");
  const categories = useCategories();

  if (!active) return null;

  const current = categories.find((c) => c.code === active);
  // On est dans une famille soit parce qu'on l'a ouverte (la famille elle-même),
  // soit parce qu'on a déjà choisi un de ses membres.
  const familyCode = current?.parentCode ?? (current ? current.code : null);
  if (!familyCode) return null;

  const family = categories.find((c) => c.code === familyCode);
  const members = categories
    .filter((c) => c.parentCode === familyCode && c.status === "active")
    .sort((a, b) => a.position - b.position);
  if (!family || members.length === 0) return null;

  const go = (code: string) =>
    applyFilters((sp) => {
      sp.set("category", code);
    });

  return (
    <div className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 lg:mx-0 lg:flex-wrap lg:px-0">
      <Pill active={active === familyCode} onClick={() => go(familyCode)}>
        {t("all")}
      </Pill>
      {members.map((m) => (
        <Pill
          key={m.code}
          active={active === m.code}
          onClick={() => go(m.code)}
        >
          <span aria-hidden>{m.emoji}</span>
          {shortLabel(locale === "ar" ? m.labelAr : m.label)}
        </Pill>
      ))}
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
        "text-body-sm inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 font-bold transition-colors",
        active
          ? "border-primary-600 bg-primary-600 text-on-brand"
          : "border-border bg-surface text-foreground hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
