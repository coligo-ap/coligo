"use client";

import type { ReactNode } from "react";
import { useNetworkOffline } from "@/lib/connectivity/network-store";
import { cn } from "@/lib/utils";

/**
 * Enveloppe le CONTENU d'une page pour le rendre « inactif visuellement » quand
 * le réseau est coupé — SANS bloquer toute l'app. Le contenu (souvent périmé)
 * est légèrement flouté + atténué pour signaler « pas à jour », mais la coque
 * autour (header, nav du bas, bandeau de connexion) reste nette et utilisable.
 *
 * Règle produit (demande explicite) : hors ligne, on ne fige pas l'écran entier.
 * On floute le contenu derrière et on laisse au moins la navigation accessible,
 * selon l'espace et la page où l'utilisateur se trouve.
 *
 * Blur volontairement LÉGER (2px) : filtre statique (pas de backdrop animé) pour
 * rester fluide même sur les téléphones d'entrée de gamme (public Algérie).
 */
export function OfflineDim({
  children,
  className,
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  /** Neutralise le floutage (ex. pages CARTE plein écran : accueil, course). */
  disabled?: boolean;
}) {
  const offline = useNetworkOffline() && !disabled;
  return (
    <div
      data-offline-dim={offline ? "1" : "0"}
      className={cn(
        "transition-[filter,opacity] duration-300 motion-reduce:transition-none",
        // Flouté + atténué mais TOUJOURS scrollable/visible : on ne fige pas
        // l'app, on signale juste que le contenu n'est pas à jour.
        offline && "opacity-70 blur-[2px]",
        className
      )}
    >
      {children}
    </div>
  );
}
