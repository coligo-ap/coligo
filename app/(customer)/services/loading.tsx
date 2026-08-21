import { Skeleton } from "@/components/ui/skeleton";

// Squelette du hub de démarrage, calqué sur la grille réelle (3 colonnes,
// rangée haute + rangée large + rangée basse) : l'écran apparaît AU TAP
// (règle navigation instantanée), le contenu se streame ensuite.
export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-6">
      <Skeleton className="mt-3 h-16 w-full rounded-lg" />
      <Skeleton className="mt-3 h-4 w-56 rounded-sm" />
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Skeleton className="aspect-[6/7] rounded-lg" />
        <Skeleton className="aspect-[6/7] rounded-lg" />
        <Skeleton className="aspect-[6/7] rounded-lg" />
        <Skeleton className="col-span-2 rounded-lg" />
        <Skeleton className="aspect-[9/7] rounded-lg" />
        <Skeleton className="aspect-[16/11] rounded-lg" />
        <Skeleton className="aspect-[16/11] rounded-lg" />
        <Skeleton className="aspect-[16/11] rounded-lg" />
      </div>
      <Skeleton className="mt-6 h-5 w-32 rounded-sm" />
      <div className="mt-2.5 flex gap-3">
        <Skeleton className="aspect-[3/4] w-[26%] rounded-lg" />
        <Skeleton className="aspect-[3/4] w-[26%] rounded-lg" />
        <Skeleton className="aspect-[3/4] w-[26%] rounded-lg" />
      </div>
    </div>
  );
}
