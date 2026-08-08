/**
 * Squelette de /coligo-pay — content-only (rendu dans le `<main>` de la coque
 * persistante). `/coligo-pay` est en `noHeader` (topbar propre, cf.
 * customer-chrome.tsx) → pas de header partagé ici, la zone sûre du haut est
 * gérée par CE squelette (comme la page réelle, `coligo-pay-loader.tsx`).
 */
export default function ColigoPayLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-24 lg:px-6">
      <div className="bg-surface-3 mb-3 h-4 w-24 animate-pulse rounded" />

      {/* Carte SOLDE (hero violet). */}
      <div className="from-primary-400 via-primary-600 to-primary-800 rounded-panel-lg bg-gradient-to-br px-6 py-6">
        <div className="h-3 w-28 rounded bg-white/30" />
        <div className="mt-6 h-3 w-20 rounded bg-white/20" />
        <div className="mt-2 h-10 w-44 rounded bg-white/30" />
      </div>

      {/* Actions. */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-3 h-20 animate-pulse rounded-lg" />
        ))}
      </div>

      {/* Historique. */}
      <div className="mt-6 space-y-3">
        <div className="bg-surface-3 h-5 w-40 animate-pulse rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 rounded-card-lg h-14 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
