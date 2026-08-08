import { Skeleton } from "@/components/ui/skeleton";

/** Frontière de chargement (règle projet : toute route qui `await` en a une). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 lg:p-6">
      <Skeleton className="h-10 w-full max-w-xl" />
      <Skeleton className="h-56 w-full" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-72 w-full" />
      ))}
    </div>
  );
}
