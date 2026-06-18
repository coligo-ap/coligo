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
        <div className="bg-surface-3 mt-4 h-28 w-full animate-pulse rounded-[18px]" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-surface-3 h-20 animate-pulse rounded-[14px]" />
          <div className="bg-surface-3 h-20 animate-pulse rounded-[14px]" />
        </div>
        <div className="mt-4 space-y-3">
          <div className="bg-surface-3 h-16 animate-pulse rounded-[14px]" />
          <div className="bg-surface-3 h-16 animate-pulse rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}
