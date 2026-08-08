/**
 * Squelette des FAVORIS — content-only (la coque persistante fournit déjà
 * header + barre du bas). Le tap « Favoris » répond instantanément.
 */
export default function FavorisLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-40 animate-pulse rounded-lg" />
      <div className="bg-surface-3 mt-2 h-4 w-56 animate-pulse rounded" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-40 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
