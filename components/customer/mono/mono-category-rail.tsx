"use client";

import { cn } from "@/lib/utils";

// =============================================================================
// MonoCategoryRail — rail de catégories du thème « bold minimalism ».
//
// Images DÉTOURÉES posées directement sur le fond de page : ni carte, ni rond,
// ni ombre derrière. L'objet flotte, le libellé se lit dessous.
//
// ÉCHELLE relevée sur fastapp.dz à 393 px : objet ~68 px de haut, pas de
// ~76 px, libellé 14 px. La première version (110 px, libellé 17 px) faisait
// des tuiles énormes qui mangeaient tout le haut de l'écran.
//
// Affordance de défilement : le conteneur déborde des gouttières (-mx-4) et n'a
// PAS de marge de fin — le dernier objet est donc coupé par le bord. Accroche
// douce et scrollbar masquée : classe `.mono-rail` (app/theme-mono.css).
// =============================================================================

export type MonoCategory = {
  code: string;
  label: string;
  /** Illustration détourée (fond transparent). */
  image: string;
  /**
   * REPLI : l'image est une PHOTO, pas un détourage. Elle est alors cadrée en
   * vignette arrondie plutôt que posée à nu — le temps de produire les
   * illustrations détourées manquantes.
   */
  photo?: boolean;
  active?: boolean;
};

export function MonoCategoryRail({
  items,
  onSelect,
}: {
  items: MonoCategory[];
  onSelect?: (code: string) => void;
}) {
  return (
    <div className="mono-rail -mx-4 flex gap-3 overflow-x-auto ps-4">
      {items.map((c) => (
        <button
          key={c.code}
          type="button"
          onClick={() => onSelect?.(c.code)}
          aria-pressed={c.active}
          className="flex w-[76px] shrink-0 flex-col items-center gap-1"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.image}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={cn(
              "h-[68px] w-full",
              c.photo
                ? "rounded-[var(--radius-card)] object-cover"
                : "object-contain"
            )}
          />
          <span
            className={cn(
              "text-body-lg w-full truncate text-center leading-tight",
              c.active
                ? "font-bold text-[var(--brand)]"
                : "font-medium text-[var(--ink)]"
            )}
          >
            {c.label}
          </span>
        </button>
      ))}
    </div>
  );
}
