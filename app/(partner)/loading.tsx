/**
 * Squelette de l'espace AGENT COLIGO PAY (point de recharge partenaire).
 * Frontière `loading.tsx` au niveau du groupe : la page `await`
 * getCurrentPartner (wallet + état) → sans cette frontière, la navigation
 * bloque jusqu'au rendu serveur. Ici, apparition instantanée + streaming.
 */
export default function PartnerLoading() {
  return (
    <div className="bg-surface-2 min-h-screen">
      <div className="mx-auto max-w-md px-4 pt-6 pb-10">
        <div className="bg-surface-3 h-7 w-44 animate-pulse rounded-lg" />
        <div className="bg-surface-3 rounded-sheet-lg mt-4 h-28 w-full animate-pulse" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-surface-3 rounded-card-lg h-20 animate-pulse" />
          <div className="bg-surface-3 rounded-card-lg h-20 animate-pulse" />
        </div>
        <div className="mt-4 space-y-3">
          <div className="bg-surface-3 rounded-card-lg h-16 animate-pulse" />
          <div className="bg-surface-3 rounded-card-lg h-16 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
