"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { getCategory, getCategoryLabel } from "@/lib/config/categories";

// =============================================================================
// CategoryStrip — catégories rondes en scroll horizontal (mécanique Uber Eats).
// AUTOCOLLANT EMOJI EN COULEUR dans un rond pastel ; la catégorie active a un
// rond violet (marque) + un trait sous le libellé. Pilotée par l'URL param
// `category` (comme la grille / la recherche) → tap = filtre instantané.
// =============================================================================

/** Libellé court pour un rond : on garde le 1er segment ("Supérette / Épicerie"
 *  → "Supérette" ; "مخبزة / حلويات" → "مخبزة"). */
function shortLabel(code: string, locale: string): string {
  const full = getCategoryLabel(code, locale);
  return full.split(/[/–-]/)[0].trim();
}

export function CategoryStrip({
  categories,
}: {
  categories: { name: string; count: number }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("category");
  const t = useTranslations("browse");
  const locale = useLocale();

  function go(category: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (category) sp.set("category", category);
    else sp.delete("category");
    const qs = sp.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  return (
    <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto border-b border-[var(--color-border)] px-4 pb-3.5 lg:mx-0 lg:px-0">
      <Tile
        emoji="🛍️"
        label={t("all")}
        active={!active}
        onClick={() => go(null)}
      />
      {categories.map((c) => (
        <Tile
          key={c.name}
          emoji={getCategory(c.name)?.emoji ?? "🏷️"}
          label={shortLabel(c.name, locale)}
          active={active === c.name}
          onClick={() => go(c.name)}
        />
      ))}
    </div>
  );
}

function Tile({
  emoji,
  label,
  active,
  onClick,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          "grid size-[54px] place-items-center rounded-full border text-[26px] leading-none transition-colors",
          active
            ? "border-primary-500 bg-primary-50 ring-primary-500/30 ring-2"
            : "bg-surface-2 border-transparent"
        )}
      >
        <span aria-hidden>{emoji}</span>
      </span>
      <span
        className={cn(
          "max-w-[68px] truncate text-[11.5px] leading-tight",
          active
            ? "text-primary-700 font-extrabold"
            : "text-foreground font-semibold"
        )}
      >
        {label}
      </span>
      {active && (
        <span className="bg-primary-500 absolute right-2 -bottom-[14px] left-2 h-[2.5px] rounded-full" />
      )}
    </button>
  );
}
