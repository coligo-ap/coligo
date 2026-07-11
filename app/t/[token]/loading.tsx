import { Loader2 } from "lucide-react";

/**
 * Frontière de chargement du partage de trajet public (`force-dynamic`).
 * Reproduit exactement le premier rendu de `ShareTrackView` (spinner centré sur
 * le fond de page Drive) pour un raccord sans flash blanc pendant l'aller-retour
 * serveur. `--d-page` est défini sur `:root`, donc valable hors scope Drive.
 */
export default function Loading() {
  return (
    <div className="drive-jakarta grid min-h-screen place-items-center bg-[var(--d-page)]">
      <Loader2 className="text-primary-600 size-6 animate-spin" />
    </div>
  );
}
