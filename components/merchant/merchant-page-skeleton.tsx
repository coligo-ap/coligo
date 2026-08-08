/**
 * Squelette générique des pages commerçant — affiché INSTANTANÉMENT à la
 * navigation (via loading.tsx) pendant que la page `await` ses données côté
 * serveur. Évite l'écran blanc → transition ressentie immédiate (règle perf
 * CLAUDE.md). La nav (header/sidebar) est conservée par le layout commerçant.
 */
export function MerchantPageSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] animate-pulse p-4 lg:p-6 lg:px-8">
      {/* Bandeau / en-tête */}
      <div className="bg-surface-3 rounded-sheet-lg mb-5 h-24 w-full" />
      {/* Barre de titre + action */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="bg-surface-3 rounded-control h-7 w-48" />
        <div className="bg-surface-3 h-9 w-32 rounded-md" />
      </div>
      {/* Lignes / cartes */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface flex items-center gap-3 rounded-lg border p-3"
          >
            <div className="bg-surface-3 size-14 shrink-0 rounded-md" />
            <div className="flex-1 space-y-2">
              <div className="bg-surface-3 h-4 w-1/3 rounded" />
              <div className="bg-surface-3 h-3 w-1/2 rounded" />
            </div>
            <div className="bg-surface-3 rounded-control h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
