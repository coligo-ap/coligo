/**
 * Squelettes de chargement chauffeur (frontières `loading.tsx`). Objectif perf :
 * le contenu réel se streame derrière un squelette qui apparaît INSTANTANÉMENT.
 * La barre de nav (`DNav`) n'est PLUS rendue ici : elle est montée une seule
 * fois dans la coque persistante `(app)/layout.tsx` et reste à l'écran pendant
 * le chargement → ces squelettes ne décrivent QUE le contenu (plus de « loading
 * global » qui redessinait nav + fond à chaque navigation). Aucune donnée ici →
 * rendu immédiat, jamais bloquant.
 */
function Bar({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block animate-pulse rounded-[8px] bg-[var(--d-soft)] ${className}`}
    />
  );
}

function RideCardSkeleton() {
  return (
    <div className="mb-2.5 rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3.5">
      <div className="flex items-center gap-2.5">
        <Bar className="size-[34px] !rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Bar className="h-3 w-2/3" />
          <Bar className="h-2 w-1/3" />
        </div>
        <Bar className="h-6 w-12" />
      </div>
      <div className="mt-3 space-y-2">
        <Bar className="h-2.5 w-full" />
        <Bar className="h-2.5 w-5/6" />
      </div>
      <Bar className="mt-2.5 h-[72px] w-full" />
      <div className="mt-3 flex gap-2">
        <Bar className="h-11 flex-1" />
        <Bar className="h-11 flex-[1.4]" />
      </div>
    </div>
  );
}

/** Page Drive — demandes / propositions. */
export function DriveSkeleton() {
  return (
    <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
      <Bar className="h-6 w-52" />
      <Bar className="mt-2 h-3 w-32" />
      <div className="mt-2.5 flex gap-1.5">
        <Bar className="h-7 w-24 !rounded-full" />
        <Bar className="h-7 w-24 !rounded-full" />
        <Bar className="h-7 w-20 !rounded-full" />
      </div>
      <div className="mt-3 flex gap-4 border-b border-[var(--d-line)] pb-2">
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-24" />
      </div>
      <div className="mt-3">
        <RideCardSkeleton />
        <RideCardSkeleton />
        <RideCardSkeleton />
      </div>
    </div>
  );
}

/** Accueil chauffeur COMPACT — carte + bandeau haut (3 zones) + feuille réduite
 *  (poignée + toggle). Reflète la mise en page RÉELLE actuelle → pas de flash de
 *  l'ancien design au rafraîchissement. */
export function HomeSkeleton() {
  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <div className="absolute inset-0 bg-[var(--d-page)]" />
      {/* Bandeau haut : courses dispo · revenu · GPS */}
      <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 grid grid-cols-3 items-start gap-2">
        <div className="flex justify-start">
          <div className="h-[44px] w-[86px] animate-pulse rounded-[16px] bg-[var(--d-surface)] shadow-lg" />
        </div>
        <div className="flex justify-center">
          <div className="h-[44px] w-[118px] animate-pulse rounded-[16px] bg-[var(--d-surface)] shadow-lg" />
        </div>
        <div className="flex justify-end">
          <div className="size-[44px] animate-pulse rounded-[16px] bg-[var(--d-surface)] shadow-lg" />
        </div>
      </div>
      {/* Feuille RÉDUITE : poignée + toggle « En ligne » */}
      <div className="over-nav absolute right-0 left-0 z-10 rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-1.5 pb-5">
        <span className="mx-auto mb-2 block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        <Bar className="h-[58px] w-full !rounded-[16px]" />
      </div>
    </div>
  );
}

/** Pages internes simples (gains, compte, etc.). */
export function PageSkeleton() {
  return (
    <div className="drive-jakarta drive-page pt-safe-lg pb-safe-nav min-h-screen bg-[var(--d-surface)] px-[18px]">
      <Bar className="h-6 w-44" />
      <Bar className="mt-2 h-3 w-28" />
      <Bar className="mt-4 h-28 w-full !rounded-[16px]" />
      <Bar className="mt-3 h-20 w-full !rounded-[16px]" />
      <Bar className="mt-3 h-20 w-full !rounded-[16px]" />
    </div>
  );
}
