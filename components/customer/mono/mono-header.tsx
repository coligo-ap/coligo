import { ChevronDown, MapPin, Search, ShoppingBag } from "lucide-react";

// =============================================================================
// MonoHeader — en-tête du thème « bold minimalism ».
//
// Posé sur le fond de page, SANS filet ni ombre : c'est le premier bloc de
// section qui marque la séparation, pas une bordure. Zone d'adresse à gauche
// (icône --brand, texte --ink), panier à droite. Recherche en pilule pleine
// largeur dessous.
// =============================================================================

export function MonoHeader({
  zone,
  cartCount = 0,
}: {
  zone: string;
  cartCount?: number;
}) {
  return (
    <header className="bg-[var(--surface-page)] px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-4">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-start"
        >
          <MapPin aria-hidden className="size-5 shrink-0 text-[var(--brand)]" />
          <span className="min-w-0">
            <span className="text-body-sm block font-medium text-[var(--ink-muted)]">
              Livrer à
            </span>
            <span className="text-title-lg flex items-center gap-1 font-bold text-[var(--ink)]">
              <span className="truncate">{zone}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            </span>
          </span>
        </button>

        <button
          type="button"
          aria-label="Panier"
          className="relative grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-[var(--surface-card)] text-[var(--ink)]"
        >
          <ShoppingBag aria-hidden className="size-5" />
          {cartCount > 0 && (
            <span className="text-label absolute -end-1 -top-1 grid size-5 place-items-center rounded-[var(--radius-pill)] bg-[var(--counter)] leading-none font-bold text-[var(--surface-card)]">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-pill)] bg-[var(--surface-card)] px-4 py-3.5">
        <Search aria-hidden className="size-5 shrink-0 text-[var(--ink)]" />
        <span className="text-title-sm font-normal text-[var(--ink-muted)]">
          Rechercher un commerce, un plat…
        </span>
      </div>
    </header>
  );
}
