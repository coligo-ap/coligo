"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

/**
 * Liste admin mise en cache (TanStack Query) sur le QueryClient PERSISTANT du
 * layout /admin (monté via AdminAlertsProvider). Pattern (cf. CLAUDE.md perf) :
 *
 *  - `initial` = données rendues côté serveur → 1er affichage INSTANTANÉ, zéro
 *    flash (pas de skeleton au premier rendu).
 *  - Au RETOUR de navigation, la liste se réaffiche INSTANTANÉMENT depuis le
 *    cache (le QueryClient survit aux navigations) puis se rafraîchit en silence.
 *  - `keepPreviousData` : pendant un refetch, on garde l'ancienne liste affichée
 *    (pas d'écran vide).
 *
 * Sécurité : l'endpoint est gardé isSuperAdmin + la RPC sous-jacente reste
 * SECURITY DEFINER gardée ; aucune donnée sensible n'est servie hors session.
 */
export function useAdminList<T>(
  key: string,
  url: string,
  initial: T[],
  staleMs = 30_000
): T[] {
  const { data } = useQuery<T[]>({
    queryKey: [key],
    queryFn: async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${key} ${res.status}`);
      return (await res.json()) as T[];
    },
    initialData: initial,
    staleTime: staleMs,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  return data ?? initial;
}
