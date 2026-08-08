/**
 * Squelette du catalogue invité (panier partagé).
 */
export default function SharedCartCatalogueLoading() {
  return (
    <div className="bg-surface-2 min-h-dvh">
      <div className="bg-surface h-16 border-b border-[color:var(--color-border)]" />
      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-3">
        <div className="bg-surface-3 rounded-card h-10 animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-20 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
