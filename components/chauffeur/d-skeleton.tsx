import { DNav } from "./d-ui";

/**
 * Squelettes de chargement chauffeur (frontières `loading.tsx`). Objectif perf :
 * la nav apparaît INSTANTANÉMENT au tap (barre du bas conservée), le contenu
 * réel se streame derrière. Aucune donnée ici → rendu immédiat, jamais bloquant.
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
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-[18px] pt-[52px] pb-24">
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
      <DNav />
    </div>
  );
}

/** Accueil chauffeur — carte + feuille (GO, finance, préférences). */
export function HomeSkeleton() {
  return (
    <div className="drive-jakarta drive-screen bg-[var(--d-page)]">
      <div className="absolute inset-0 bg-[var(--d-page)]" />
      <div className="absolute top-[64px] left-4 h-9 w-28 animate-pulse rounded-full bg-[var(--d-surface)] shadow" />
      <div className="absolute top-[64px] right-4 size-[42px] animate-pulse rounded-full bg-[var(--d-surface)] shadow" />
      <div className="absolute right-0 bottom-[66px] left-0 z-10 rounded-t-[28px] border-t border-[var(--d-line)] bg-[var(--d-surface)] px-5 pt-3 pb-6">
        <span className="mx-auto mb-3 block h-[5px] w-[42px] rounded-full bg-[var(--d-line)]" />
        <Bar className="h-[52px] w-full !rounded-[20px]" />
        <div className="mt-2 flex gap-1.5">
          <Bar className="h-[62px] flex-1 !rounded-[14px]" />
          <Bar className="h-[62px] w-[94px] !rounded-[14px]" />
        </div>
        <div className="mt-2 flex gap-1.5">
          <Bar className="h-[46px] flex-1 !rounded-[12px]" />
          <Bar className="h-[46px] flex-1 !rounded-[12px]" />
        </div>
        <Bar className="mt-2 h-[58px] w-full !rounded-[15px]" />
      </div>
      <DNav />
    </div>
  );
}

/** Pages internes simples (gains, compte, etc.). */
export function PageSkeleton() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-[18px] pt-[52px] pb-24">
      <Bar className="h-6 w-44" />
      <Bar className="mt-2 h-3 w-28" />
      <Bar className="mt-4 h-28 w-full !rounded-[16px]" />
      <Bar className="mt-3 h-20 w-full !rounded-[16px]" />
      <Bar className="mt-3 h-20 w-full !rounded-[16px]" />
      <DNav />
    </div>
  );
}
