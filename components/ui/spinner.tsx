import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Indicateur de chargement. Jusqu'ici chaque écran inlinait son propre
 * `<Loader2 className="animate-spin" />` — même geste écrit des dizaines de
 * fois, avec des tailles toutes différentes.
 *
 * Rappel de la règle produit : tout bouton qui déclenche une action asynchrone
 * passe en `pending` DÈS le clic (cf. ActionButton), avec un état LOCAL par
 * élément — jamais un état global qui fige la page.
 */
const SIZES = { sm: "size-4", md: "size-5", lg: "size-6", xl: "size-8" };

export function Spinner({
  size = "md",
  className,
  label,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Texte lu par les lecteurs d'écran (défaut : « Chargement »). */
  label?: string;
}) {
  return (
    <>
      <Loader2
        aria-hidden
        className={cn("animate-spin", SIZES[size], className)}
      />
      <span className="sr-only">{label ?? "Chargement"}</span>
    </>
  );
}
