import { cn } from "@/lib/utils";

// =============================================================================
// Ligne de MÉTA d'une carte commerce — un seul patron pour les deux variantes
// (grande carte d'accueil, carte compacte des listes) et pour tout écran qui
// affichera demain les mêmes informations.
//
// Discipline portée par ce composant :
//  - tout en gris moyen (`text-muted`), graisse NORMALE : aucune méta ne
//    concurrence le nom du commerce, seule information dominante du bloc ;
//  - le séparateur « · » VOYAGE AVEC son élément (il est rendu à l'intérieur
//    de `MetaItem`, pas entre deux frères) → quand la ligne passe à la ligne
//    suivante, plus de point orphelin en bout de ligne.
// =============================================================================

export function MetaRow({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "text-muted text-body-sm flex flex-wrap items-center gap-x-1.5 gap-y-0.5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function MetaItem({
  /** Premier élément de la ligne : pas de séparateur devant. */
  first,
  children,
}: {
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {!first && (
        <span className="bg-subtle size-[3px] rounded-full" aria-hidden />
      )}
      <span className="inline-flex items-center gap-1">{children}</span>
    </span>
  );
}
