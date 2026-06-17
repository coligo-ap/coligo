"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchDriverGains } from "@/app/(driver)/actions";
import { GainsView } from "./gains-view";

/**
 * Charge les gains via TanStack Query (cache partagé, clé par livreur). Au
 * retour sur l'onglet Gains, les données s'affichent INSTANTANÉMENT depuis le
 * cache puis se rafraîchissent en silence si périmées (staleTime). Aucune
 * requête bloquante : la 1ʳᵉ visite montre un skeleton léger pendant le fetch.
 *
 * Sécurité : la clé inclut driverId (isolation par compte) et l'action serveur
 * ré-authentifie + applique les RLS à chaque appel.
 */
export function GainsLoader({ driverId }: { driverId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ["driver-gains", driverId],
    queryFn: async () => (await fetchDriverGains()).entries,
    placeholderData: keepPreviousData,
  });

  if (isPending && !data) {
    return (
      <div className="space-y-4 pt-1">
        <div className="flex items-center justify-between">
          <div className="h-7 w-28 animate-pulse rounded-lg bg-[var(--soft)]" />
          <div className="size-10 animate-pulse rounded-[13px] bg-[var(--soft)]" />
        </div>
        <div className="h-10 w-full animate-pulse rounded-[14px] bg-[var(--soft)]" />
        <div className="h-44 animate-pulse rounded-[20px] bg-[var(--soft)]" />
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-20 animate-pulse rounded-[16px] bg-[var(--soft)]" />
          <div className="h-20 animate-pulse rounded-[16px] bg-[var(--soft)]" />
        </div>
      </div>
    );
  }

  return <GainsView entries={data ?? []} />;
}
