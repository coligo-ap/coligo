import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette dédié à la LISTE des commandes (`/commandes`, onglet principal,
 * page `full`). Frontière propre au segment : le tap sur l'onglet « Commandes »
 * affiche INSTANTANÉMENT titre + onglets + cartes, pendant que la session se
 * résout et que TanStack Query réhydrate la liste depuis le cache.
 */
export default function OrdersListLoading() {
  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      {/* Header sticky (placeholder). */}
      <div className="border-border bg-surface sticky top-0 z-10 h-14 border-b" />
      <main className="pb-20 lg:pb-0">
        <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
          {/* Titre + sous-titre. */}
          <div className="mb-5 space-y-2">
            <div className="bg-surface-3 h-7 w-44 animate-pulse rounded-lg" />
            <div className="bg-surface-3 h-4 w-60 animate-pulse rounded" />
          </div>

          {/* Onglets (En cours / Terminées). */}
          <div className="bg-surface-3 h-10 w-56 animate-pulse rounded-[12px]" />

          {/* Cartes commandes. */}
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-3 h-24 animate-pulse rounded-[16px]"
              />
            ))}
          </div>
        </div>
      </main>
      <CustomerBottomNav hiddenKeys={[]} />
    </div>
  );
}
