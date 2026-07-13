/**
 * Squelette de la RECHERCHE — content-only (coque persistante). Barre de
 * recherche + chips + grille produits fantômes.
 */
export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-11 w-full animate-pulse rounded-[13px]" />
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-8 w-20 animate-pulse rounded-full"
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-48 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
    </div>
  );
}
