"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { getCategory, getCategoryLabel } from "@/lib/config/categories";

// =============================================================================
// CategoryStrip — catégories rondes en scroll horizontal (mécanique Uber Eats).
// Emoji dans un rond ; la catégorie active a un rond noir + un trait noir
// dessous. Pilotée par l'URL param `category` (comme la grille / la recherche),
// donc tap = filtre instantané sans recharger la page.
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

  function go(category: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (category) sp.set("category", category);
    else sp.delete("category");
    const qs = sp.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  return (
    <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto border-b border-[var(--color-border)] px-4 pb-3.5 lg:mx-0 lg:px-0">
      <Tile emoji="🛒" label="Tous" active={!active} onClick={() => go(null)} />
      {categories.map((c) => (
        <Tile
          key={c.name}
          emoji={getCategory(c.name)?.emoji ?? "🏷️"}
          label={shortLabel(c.name)}
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
          "grid size-[54px] place-items-center rounded-full text-[26px] transition-colors",
          active ? "bg-foreground" : "bg-surface-2"
        )}
      >
        {emoji}
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
