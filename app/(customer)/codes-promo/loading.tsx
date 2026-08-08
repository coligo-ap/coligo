/**
 * Squelette des CODES PROMO — content-only (coque persistante).
 */
export default function CodesPromoLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-44 animate-pulse rounded-lg" />
      <div className="bg-surface-3 rounded-card mt-4 h-12 w-full animate-pulse" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-24 animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  );
}
