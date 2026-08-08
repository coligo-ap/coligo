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
 * PHOTOS par défaut des filtres (public/categories/photos/*.jpg) : vraies
 * photos façon Uber Eats — plein cadre dans le rond (cover), recadrées carré
 * 320px, licences CC0/PDM (CREDITS.txt du dossier). L'image ADMIN (mig 0311,
 * /admin/categories) reste prioritaire quand elle est définie. Un chemin du
 * dossier stickers/ (images détourées) se rendrait en `contain` ; les photos
 * (ce jeu + uploads admin) se rendent en `cover`.
 */
const CATEGORY_FILTER_IMAGE: Record<string, string> = {
  superette: "/categories/photos/superette.jpg",
  boulangerie: "/categories/photos/boulangerie.jpg",
  pizzeria: "/categories/photos/pizzeria.jpg",
  fast_food: "/categories/photos/fast_food.jpg",
  restaurant: "/categories/photos/restaurant.jpg",
  cafe: "/categories/photos/cafe.jpg",
  glacier: "/categories/photos/glacier.jpg",
  boucherie: "/categories/photos/boucherie.jpg",
  poissonnerie: "/categories/photos/poissonnerie.jpg",
  fruits_legumes: "/categories/photos/fruits_legumes.jpg",
  produits_bio: "/categories/photos/produits_bio.jpg",
  fleuriste: "/categories/photos/fleuriste.jpg",
  pharmacie: "/categories/photos/pharmacie.jpg",
};

/** Un chemin d'image détourée locale → rendu « objet flottant » (contain). */
const isSticker = (src: string) => src.startsWith("/categories/stickers/");

export function CategoryStrip({
  categories,
  onHero = false,
}: {
  categories: { name: string; count: number }[];
  /** Posée SUR le héro thémé (mig 0417) : libellés blancs, anneau blanc. */
  onHero?: boolean;
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
    <div
      className={cn(
        "scrollbar-hide -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-3 lg:mx-0 lg:px-0",
        // Sur le héro thémé (mig 0417) : pas de trait de séparation — la fin
        // du design (bord arrondi) fait office de séparation.
        onHero ? "" : "border-b border-[var(--color-border)]"
      )}
    >
      <Tile
        emoji="🛍️"
        imageSrc="/categories/photos/tous.jpg"
        label={t("all")}
        active={!active}
        onHero={onHero}
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
              onHero={onHero}
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
  onHero = false,
  onClick,
}: {
  emoji: string;
  imageSrc?: string;
  label: string;
  active: boolean;
  onHero?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex w-[62px] shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          // Tuile RONDE compacte (56 px, gabarit Uber Eats) : photo pleine en
          // cover, ou image détourée qui flotte en contain. Le filtre APPLIQUÉ
          // se voit par sa COULEUR seule (anneau violet net + halo) — jamais
          // de bandeau récapitulatif ailleurs (demande produit 06/08).
          "grid size-[56px] place-items-center overflow-hidden rounded-full text-[24px] leading-none transition-all",
          active
            ? onHero
              ? "border-2 border-white bg-white/20 shadow-[0_4px_14px_-6px_rgba(0,0,0,.4)] ring-2 ring-white/40"
              : "border-primary-600 ring-primary-500/25 bg-primary-50 border-2 shadow-[0_4px_14px_-6px_rgba(108,43,217,.45)] ring-2"
            : onHero
              ? "border-[1.5px] border-white/25 bg-white/10"
              : "bg-surface-2 border-[1.5px] border-transparent"
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
                ? // Autocollant : objet centré qui respire dans le rond (padding
                  // suffisant pour qu'aucun bord ne soit rogné par le cercle).
                  "object-contain p-1"
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
          "text-caption max-w-[62px] truncate leading-tight",
          active
            ? onHero
              ? "font-extrabold text-white"
              : "text-primary-700 font-extrabold"
            : onHero
              ? "font-semibold text-white/85"
              : "text-foreground font-semibold"
        )}
      >
        {label}
      </span>
    </button>
  );
}
