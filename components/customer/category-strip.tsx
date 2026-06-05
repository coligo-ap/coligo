"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCategoryLabel } from "@/lib/config/categories";
import { categoryIcon, ALL_CATEGORIES_ICON } from "@/lib/config/category-icon";

// =============================================================================
// CategoryStrip — catégories rondes en scroll horizontal (mécanique Uber Eats).
// Icône PROFESSIONNELLE (lucide) dans un rond gris clair ; la catégorie active a
// un rond foncé + un trait sous le libellé. Pilotée par l'URL param `category`
// (comme la grille / la recherche) → tap = filtre instantané sans recharger.
// =============================================================================

/** Libellé court pour un rond : on garde le 1er segment ("Supérette / Épicerie"
 *  → "Supérette"). */
function shortLabel(code: string): string {
  const full = getCategoryLabel(code);
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
        icon={ALL_CATEGORIES_ICON}
        label={t("all")}
        active={!active}
        onClick={() => go(null)}
      />
      {categories.map((c) => (
        <Tile
          key={c.name}
          icon={categoryIcon(c.name)}
          label={shortLabel(c.name)}
          active={active === c.name}
          onClick={() => go(c.name)}
        />
      ))}
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
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
          "grid size-[54px] place-items-center rounded-full border transition-colors",
          active
            ? "bg-foreground border-foreground text-white"
            : "bg-surface-2 text-foreground border-transparent"
        )}
      >
        <Icon className="size-6" strokeWidth={1.75} />
      </span>
      <span
        className={cn(
          "text-foreground max-w-[68px] truncate text-[11.5px] leading-tight",
          active ? "font-extrabold" : "font-semibold"
        )}
      >
        {label}
      </span>
      {active && (
        <span className="bg-foreground absolute right-2 -bottom-[14px] left-2 h-[2.5px] rounded-full" />
      )}
    </button>
  );
}
