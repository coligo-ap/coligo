"use client";

import type { ReactNode } from "react";
import {
  cardGradientCss,
  cardLogoAssetPath,
  getCardTemplate,
} from "@/lib/loyalty/card-templates";

// =============================================================================
// LoyaltyCardFace — la CARTE FIDÉLITÉ Coligo à l'écran, réplique du recto
// imprimé v2 (0462) : dégradé diagonal violet → rose (mêmes stops que le PDF —
// source unique card-templates), facettes translucides, logotype Coligo FR+AR,
// titre « CARTE DE FIDÉLITÉ » en ITALIQUE avec « بطاقة الوفاء » dessous
// (bilingue SUR la carte, comme l'objet physique — pas un texte d'interface),
// numéro en pied. Couleurs FIXES quels que soient le thème et la langue.
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
  className = "",
}: {
  children: ReactNode;
  /** Numéro imprimé en pied (mono, groupé par 4) — ex. handle ou n° de carte. */
  code?: string | null;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-panel-lg relative overflow-hidden px-5 pt-5 pb-5 text-white " +
        className
      }
      style={{ backgroundImage: cardGradientCss(TPL) }}
    >
      <Facets />
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardLogoAssetPath(TPL)}
            alt="Coligo"
            className="h-8 w-auto"
          />
          {/* Titre du recto v2 : grand, MAJUSCULES, italique — l'arabe dessous. */}
          <span className="shrink-0 pt-0.5 text-end">
            <span className="block text-sm leading-none font-black tracking-tight italic">
              CARTE DE FIDÉLITÉ
            </span>
            <span
              dir="rtl"
              className="mt-1 block text-xs leading-none italic opacity-90"
            >
              بطاقة الوفاء
            </span>
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
