"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCategories } from "@/lib/hooks/use-categories";
import { cn } from "@/lib/utils";
import { getCategory, getCategoryLabel } from "@/lib/config/categories";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";

// =============================================================================
// CategoryStrip — filtres catégories en scroll horizontal, façon BOLT FOOD :
// tuile CARRÉ ARRONDI au fond neutre doux, AUTOCOLLANT (illustration propre,
// objet centré sur fond transparent — jamais une photo chargée) qui flotte
// dans la tuile, libellé court dessous. La catégorie active = tuile teintée +
// bord violet (marque) + libellé accentué. Pilotée par l'URL param `category`
// (comme la grille / la recherche) → tap = filtre instantané.
// =============================================================================

/** Libellé court pour une tuile : on garde le 1er segment ("Supérette /
 *  Épicerie" → "Supérette" ; "مخبزة / حلويات" → "مخبزة"). */
function shortLabel(code: string, locale: string): string {
  const full = getCategoryLabel(code, locale);
  return full.split(/[/–-]/)[0].trim();
}

/**
 * AUTOCOLLANTS par défaut des filtres (public/categories/stickers/*.svg) : jeu
 * dessiné maison, style homogène (objet + dégradés doux + ombre au sol, fond
 * transparent). L'image ADMIN (mig 0311, /admin/categories) reste prioritaire
 * quand elle est définie. Un autocollant se rend en `contain` (il flotte dans
 * la tuile) ; toute autre image (photo uploadée) reste en `cover`.
 */
const CATEGORY_FILTER_IMAGE: Record<string, string> = {
  superette: "/categories/stickers/superette.svg",
  boulangerie: "/categories/stickers/boulangerie.svg",
  pizzeria: "/categories/stickers/pizzeria.svg",
  fast_food: "/categories/stickers/fast_food.svg",
  restaurant: "/categories/stickers/restaurant.svg",
  cafe: "/categories/stickers/cafe.svg",
  glacier: "/categories/stickers/glacier.svg",
  boucherie: "/categories/stickers/boucherie.svg",
  poissonnerie: "/categories/stickers/poissonnerie.svg",
  fruits_legumes: "/categories/stickers/fruits_legumes.svg",
  produits_bio: "/categories/stickers/produits_bio.svg",
  fleuriste: "/categories/stickers/fleuriste.svg",
  pharmacie: "/categories/stickers/pharmacie.svg",
};

/** Un chemin d'autocollant local → rendu « objet flottant » (contain). */
const isSticker = (src: string) => src.startsWith("/categories/stickers/");

export function CategoryStrip({
  categories,
}: {
  categories: { name: string; count: number }[];
}) {
  const params = useFilterParams();
  const active = params.get("category");
  const t = useTranslations("browse");
  const locale = useLocale();
  // Catégories pilotées en base (mig 0311) : images admin + statuts (une
  // catégorie masquée n'apparaît pas dans le strip même avec des commerçants).
  // Mig 0336 : show_marketplace retire du strip sans toucher l'inscription,
  // et l'ordre = POSITION admin (reclassement /admin/categories).
  const dbCategories = useCategories();
  const dbByCode = new Map(dbCategories.map((c) => [c.code, c]));
  const orderByCode = new Map(dbCategories.map((c, i) => [c.code, i]));
  const ordered = [...categories].sort(
    (a, b) =>
      (orderByCode.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
      (orderByCode.get(b.name) ?? Number.MAX_SAFE_INTEGER)
  );

  function go(category: string | null) {
    applyFilters((sp) => {
      if (category) sp.set("category", category);
      else sp.delete("category");
    });
  }

  return (
    <div className="scrollbar-hide -mx-4 flex gap-2.5 overflow-x-auto border-b border-[var(--color-border)] px-4 pb-3 lg:mx-0 lg:px-0">
      <Tile
        emoji="🛍️"
        imageSrc="/categories/stickers/tous.svg"
        label={t("all")}
        active={!active}
        onClick={() => go(null)}
      />
      {ordered
        .filter((c) => {
          const db = dbByCode.get(c.name);
          if (!db) return true; // code hors table (repli) : comportement d'avant
          return db.status === "active" && db.showMarketplace;
        })
        .map((c) => {
          const db = dbByCode.get(c.name);
          return (
            <Tile
              key={c.name}
              emoji={db?.emoji ?? getCategory(c.name)?.emoji ?? "🏷️"}
              imageSrc={db?.imageUrl ?? CATEGORY_FILTER_IMAGE[c.name]}
              label={
                db
                  ? (locale === "ar" ? db.labelAr : db.label)
                      .split(/[/–-]/)[0]
                      .trim()
                  : shortLabel(c.name, locale)
              }
              active={active === c.name}
              onClick={() => go(c.name)}
            />
          );
        })}
    </div>
  );
}

function Tile({
  emoji,
  imageSrc,
  label,
  active,
  onClick,
}: {
  emoji: string;
  imageSrc?: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          // Tuile façon Bolt Food : carré arrondi doux, l'autocollant FLOTTE
          // dedans (contain + padding) — jamais de photo pleine qui sature.
          "grid size-[64px] place-items-center overflow-hidden rounded-[18px] border-[1.5px] text-[28px] leading-none transition-all",
          active
            ? "border-primary-500 bg-primary-50 shadow-[0_4px_14px_-6px_rgba(108,43,217,.45)]"
            : "bg-surface-2 border-transparent"
        )}
      >
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full",
              isSticker(imageSrc)
                ? // Autocollant : objet centré qui respire dans la tuile.
                  "scale-[1.04] object-contain p-1.5"
                : // Photo (upload admin) : plein cadre, comportement d'avant.
                  "object-cover"
            )}
          />
        ) : (
          <span aria-hidden>{emoji}</span>
        )}
      </span>
      <span
        className={cn(
          "max-w-[72px] truncate text-[11.5px] leading-tight",
          active
            ? "text-primary-700 font-extrabold"
            : "text-foreground font-semibold"
        )}
      >
        {label}
      </span>
    </button>
  );
}
