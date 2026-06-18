/**
 * Squelette de /cashback — content-only (rendu dans le `<main>` de la coque
 * persistante). Pas de coque ici → pas de « loading global ».
 */
export default function CashbackLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 lg:px-6">
      <div className="bg-surface-3 mt-1 mb-2 h-4 w-24 animate-pulse rounded" />

      {/* Hero solde. */}
      <div className="from-primary-400 via-primary-600 to-primary-800 -mx-4 bg-gradient-to-br px-5 pt-7 pb-7 lg:-mx-6 lg:px-6">
        <div className="h-3 w-40 rounded bg-white/30" />
        <div className="mt-2 h-9 w-40 rounded bg-white/30" />
        <div className="mt-3 h-3 w-64 rounded bg-white/20" />
      </div>

      {/* Carte lien Coligo Pay. */}
      <div className="bg-surface-3 mt-4 h-[78px] animate-pulse rounded-[18px]" />

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
