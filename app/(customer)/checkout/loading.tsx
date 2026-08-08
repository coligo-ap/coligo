/**
 * Squelette du CHECKOUT — content-only (coque persistante) : adresse, créneau,
 * paiement et bouton de confirmation fantômes.
 */
export default function CheckoutLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 h-7 w-48 animate-pulse rounded-lg" />
      <div className="mt-4 space-y-3">
        <div className="bg-surface-3 h-24 animate-pulse rounded-lg" />
        <div className="bg-surface-3 h-20 animate-pulse rounded-lg" />
        <div className="bg-surface-3 h-28 animate-pulse rounded-lg" />
        <div className="bg-surface-3 h-24 animate-pulse rounded-lg" />
      </div>
      <div className="bg-surface-3 rounded-card-lg mt-4 h-12 w-full animate-pulse" />
    </div>
  );
}
