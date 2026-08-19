import { Skeleton } from "@/components/ui/skeleton";

// Squelette du hub de démarrage : héro + grille de cartes — l'écran apparaît
// AU TAP (règle navigation instantanée), le contenu se streame ensuite.
export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-6">
      <Skeleton className="mt-3 h-32 w-full rounded-lg" />
      <Skeleton className="mt-4 h-20 w-full rounded-lg" />
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Skeleton className="col-span-2 h-24 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2">
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
      </div>
    </div>
  );
}
