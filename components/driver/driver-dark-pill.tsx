"use client";

import { Moon, Sun } from "lucide-react";
import { useDriverDark, toggleDriverDark } from "@/lib/driver/theme-store";

/**
 * Bascule clair / sombre LIVREUR, accessible directement depuis l'en-tête de
 * l'accueil (plus besoin d'aller dans Compte). Instantané : le thème livreur est
 * un store réactif (`useDriverDark`) appliqué via `.dark` sur [data-space=driver]
 * → aucun aller-retour serveur.
 */
export function DriverDarkPill({ className }: { className?: string }) {
  const dark = useDriverDark();
  return (
    <button
      type="button"
      onClick={() => toggleDriverDark()}
      aria-label={dark ? "Mode clair" : "Mode sombre"}
      aria-pressed={dark}
      className={
        "border-border bg-surface text-muted hover:text-foreground grid size-9 shrink-0 place-items-center rounded-full border shadow-sm " +
        (className ?? "")
      }
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
