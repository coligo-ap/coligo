/**
 * Squelette de la LISTE des commandes — content-only (rendu dans le `<main>` de
 * la coque persistante, qui fournit déjà header + barre du bas). Pas de coque
 * ici → pas de « loading global ».
 */
export default function OrdersListLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="mb-5 space-y-2">
        <div className="bg-surface-3 h-7 w-44 animate-pulse rounded-lg" />
        <div className="bg-surface-3 h-4 w-60 animate-pulse rounded" />
      </div>
      <div className="bg-surface-3 h-10 w-56 animate-pulse rounded-[12px]" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-24 animate-pulse rounded-[16px]"
          />
        ))}
      </div>
    </div>
  );
}
