/**
 * Squelette du DÉTAIL d'une commande — content-only (rendu dans le `<main>` de
 * la coque persistante). Pas de coque ici → pas de « loading global ».
 */
export default function OrderDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4 lg:px-6 lg:py-8">
      <div className="bg-surface-3 mb-4 h-4 w-28 animate-pulse rounded" />
      <div className="bg-surface-3 h-32 animate-pulse rounded-[18px]" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="bg-surface-3 size-8 shrink-0 animate-pulse rounded-full" />
            <div className="bg-surface-3 h-4 flex-1 animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        <div className="bg-surface-3 h-5 w-32 animate-pulse rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-14 animate-pulse rounded-[14px]"
          />
        ))}
        <div className="bg-surface-3 mt-2 h-16 animate-pulse rounded-[16px]" />
      </div>
    </div>
  );
}
