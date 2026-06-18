/**
 * Squelette de /coligo-pay — content-only (rendu dans le `<main>` de la coque
 * persistante, qui fournit header + barre du bas). Pas de coque ici → pas de
 * « loading global ».
 */
export default function ColigoPayLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-2 pb-24 lg:px-6">
      <div className="bg-surface-3 mb-3 h-4 w-24 animate-pulse rounded" />

      {/* Carte SOLDE (hero violet). */}
      <div className="from-primary-400 via-primary-600 to-primary-800 rounded-[26px] bg-gradient-to-br px-6 py-6">
        <div className="h-3 w-28 rounded bg-white/30" />
        <div className="mt-6 h-3 w-20 rounded bg-white/20" />
        <div className="mt-2 h-10 w-44 rounded bg-white/30" />
      </div>

      {/* Actions. */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-20 animate-pulse rounded-[16px]"
          />
        ))}
      </div>

      {/* Historique. */}
      <div className="mt-6 space-y-3">
        <div className="bg-surface-3 h-5 w-40 animate-pulse rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-14 animate-pulse rounded-[14px]"
          />
        ))}
      </div>
    </div>
  );
}
