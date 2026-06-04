"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cœur favori sur la carte commerce (style Uber Eats).
 *
 * Visuel uniquement pour l'instant : le toggle est local (pas de persistance).
 * Le système de favoris côté compte est une tâche séparée — ce composant pose
 * l'emplacement et l'interaction sans prétendre à un backend. Comme il vit dans
 * un <Link>, on stoppe la propagation pour ne pas naviguer au tap sur le cœur.
 */
export function FavoriteHeart({ className }: { className?: string }) {
  const [fav, setFav] = useState(false);
  return (
    <button
      type="button"
      aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
      aria-pressed={fav}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFav((v) => !v);
      }}
      className={cn(
        "grid size-9 place-items-center rounded-full bg-white/95 shadow-md backdrop-blur transition-transform active:scale-90",
        className
      )}
    >
      <Heart
        className={cn(
          "size-[18px] transition-colors",
          fav ? "fill-coral-500 text-coral-500" : "text-foreground"
        )}
      />
    </button>
  );
}
