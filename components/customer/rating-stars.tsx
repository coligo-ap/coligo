import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// RatingStars — affichage compact d'une moyenne d'étoiles (ambre).
// =============================================================================
// Si count === 0 → renvoie null (le caller ne doit pas afficher de placeholder
// "0 étoile" / "pas encore noté" pour ne pas saturer l'UI).
// =============================================================================

type Props = {
  avg: number;
  count: number;
  /** Affiche le nombre d'avis entre parenthèses à côté de la moyenne. */
  showCount?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export function RatingStars({
  avg,
  count,
  showCount = true,
  size = "sm",
  className,
}: Props) {
  if (count <= 0) return null;
  const star = size === "md" ? "size-4" : "size-3.5";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold text-amber-600",
        size === "md" ? "text-sm" : "text-xs",
        className
      )}
    >
      <Star className={cn(star, "fill-amber-400 text-amber-400")} />
      <span className="tabular-nums">{avg.toFixed(1)}</span>
      {showCount && <span className="text-muted font-medium">({count})</span>}
    </span>
  );
}
