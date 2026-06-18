import { CustomerBottomNav } from "@/components/customer/customer-bottom-nav";

/**
 * Squelette de chargement de l'espace CLIENT (frontière `loading.tsx` au niveau
 * du groupe `(customer)`). Sans lui, chaque page (force-dynamic, qui `await`
 * l'auth + le shell + ses données) bloquait la navigation jusqu'au rendu
 * serveur complet → transition lente entre écrans. Ici l'écran apparaît
 * INSTANTANÉMENT (chrome + skeleton de contenu), les données arrivent ensuite
 * en streaming. Rend aussi le prefetch des `<Link>` réellement utile.
 */
export default function CustomerLoading() {
  return (
    <div data-space="client" className="bg-surface-2 min-h-screen">
      {/* En-tête (placeholder, hauteur du header sticky) */}
      <div className="border-border bg-surface sticky top-0 z-10 h-14 border-b" />
      <main className="mx-auto max-w-[1100px] px-4 pt-4 pb-24 lg:pb-8">
        <div className="bg-surface-3 h-7 w-48 animate-pulse rounded-lg" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-3 h-28 animate-pulse rounded-[16px]"
            />
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
          <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
          <div className="bg-surface-3 h-20 animate-pulse rounded-[16px]" />
        </div>
      </main>
      <CustomerBottomNav hiddenKeys={[]} />
    </div>
  );
}
