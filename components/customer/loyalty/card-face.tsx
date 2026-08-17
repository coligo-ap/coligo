"use client";

import type { ReactNode } from "react";
import {
  cardGradientCss,
  cardLogoAssetPath,
  getCardTemplate,
} from "@/lib/loyalty/card-templates";

// =============================================================================
// LoyaltyCardFace — la CARTE FIDÉLITÉ Coligo à l'écran, réplique du recto
// imprimé (maquette 11482, reproduction exigée par le propriétaire) : dégradé
// diagonal violet → rose (mêmes stops que le PDF — source unique
// card-templates), facettes translucides, logotype Coligo FR+AR, pilule
// « CARTE FIDÉLITÉ · بطاقة الوفاء » (bilingue SUR la carte, comme l'objet
// physique — ce n'est pas un texte d'interface), numéro en pied.
// Couleurs FIXES quels que soient le thème et la langue : c'est la carte.
// =============================================================================

const TPL = getCardTemplate("violet");

function Facets() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {/* Bandes diagonales translucides (facettes de la maquette). */}
      <div className="absolute start-[48%] -top-10 -bottom-10 w-24 -skew-x-12 bg-white/[.05]" />
      <div className="absolute start-[70%] -top-10 -bottom-10 w-44 -skew-x-12 bg-white/[.04]" />
      {/* Carré arrondi tourné, en contour discret (près du bloc « CHEZ »). */}
      <div className="absolute end-[4%] top-[22%] size-40 rotate-12 rounded-3xl border border-white/[.07]" />
      {/* Voile doux dans le coin haut-droite. */}
      <div className="absolute -end-16 -top-24 size-72 rounded-full bg-white/10 blur-3xl" />
    </div>
  );
}

export function LoyaltyCardFace({
  children,
  code,
  compact = false,
  className = "",
}: {
  children: ReactNode;
  /** Numéro imprimé en pied (mono, groupé par 4) — ex. handle ou n° de carte. */
  code?: string | null;
  /** Cartes-magasins en liste : chrome resserré (logo plus petit). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-panel-lg relative overflow-hidden text-white " +
        (compact ? "p-4 " : "px-5 pt-5 pb-5 ") +
        className
      }
      style={{ backgroundImage: cardGradientCss(TPL) }}
    >
      <Facets />
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardLogoAssetPath(TPL)}
            alt="Coligo"
            className={compact ? "h-6 w-auto" : "h-8 w-auto"}
          />
          <span className="text-caption flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-extrabold tracking-wider whitespace-nowrap">
            CARTE FIDÉLITÉ
            <span className="opacity-75">·</span>
            <span dir="rtl">بطاقة الوفاء</span>
          </span>
        </div>

        {children}

        {code && (
          <p className="mt-3.5 font-mono text-sm font-bold tracking-[.35em] opacity-95">
            {code}
          </p>
        )}
      </div>
    </div>
  );
}
