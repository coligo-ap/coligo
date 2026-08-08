/**
 * Squelette d'une VITRINE COMMERÇANT — content-only (coque persistante) :
 * couverture, en-tête boutique, chips catégories et grille produits fantômes.
 * La page la plus visitée après l'accueil : le tap doit répondre au doigt.
 */
export default function MerchantLoading() {
  return (
    <div className="mx-auto max-w-3xl lg:px-6 lg:py-6">
      {/* Couverture */}
      <div className="bg-surface-3 lg:rounded-sheet-lg h-40 w-full animate-pulse" />
      {/* En-tête boutique */}
      <div className="flex items-center gap-3 px-4 py-4 lg:px-0">
        <div className="bg-surface-3 size-14 shrink-0 animate-pulse rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="bg-surface-3 h-5 w-48 animate-pulse rounded" />
          <div className="bg-surface-3 h-4 w-32 animate-pulse rounded" />
        </div>
      </div>
      {/* Chips catégories */}
      <div className="flex gap-2 px-4 lg:px-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-8 w-24 animate-pulse rounded-full"
          />
        ))}
      </div>
      {/* Grille produits */}
      <div className="mt-4 grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:px-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-48 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
