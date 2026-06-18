import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette dédié au DÉTAIL d'une commande (`/commandes/[id]`, page `full`).
 * Frontière propre au segment : le tap depuis la liste affiche INSTANTANÉMENT
 * la forme du suivi (en-tête statut + étapes + articles + total), pendant que
 * la commande se charge — au lieu du squelette « marketplace » du groupe.
 */
export default function OrderDetailLoading() {
  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      {/* Header sticky (placeholder). */}
      <div className="border-border bg-surface sticky top-0 z-10 h-14 border-b" />
      <main className="pb-20 lg:pb-0">
        <div className="mx-auto max-w-2xl px-4 py-4 lg:px-6 lg:py-8">
          <div className="bg-surface-3 mb-4 h-4 w-28 animate-pulse rounded" />

          {/* Carte statut + suivi. */}
          <div className="bg-surface-3 h-32 animate-pulse rounded-[18px]" />

          {/* Étapes de suivi. */}
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="bg-surface-3 size-8 shrink-0 animate-pulse rounded-full" />
                <div className="bg-surface-3 h-4 flex-1 animate-pulse rounded" />
              </div>
            ))}
          </div>

          {/* Articles + total. */}
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
      </main>
      <CustomerBottomNav hiddenKeys={[]} />
    </div>
  );
}
