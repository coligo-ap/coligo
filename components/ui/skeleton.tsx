import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bloc de squelette. Avant, 118 fichiers réécrivaient à la main leurs barres
 * `animate-pulse rounded bg-…` — d'où des gris et des rayons différents d'un
 * écran à l'autre.
 *
 * À utiliser dans les `loading.tsx` (obligatoires sur toute route qui `await`
 * côté serveur) et dans les listes en cours de chargement.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-control bg-surface-3 animate-pulse",
        "motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}

/** Lignes de texte de largeur dégressive — le motif de squelette le plus courant. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}
