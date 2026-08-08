"use client";

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchCatalog } from "@/app/(merchant)/catalog/actions";
import { CatalogView } from "@/components/merchant/catalog-view";

/**
 * Catalogue via TanStack Query (cache partagé persistant — provider monté dans
 * MerchantShell, clé par commerçant). Au retour sur /catalog : affichage
 * INSTANTANÉ depuis le cache + revalidation en fond (staleTime 0). Les mutations
 * de CatalogView (ajout / suppression / réordonnancement) appellent `onMutated`
 * → invalidation de la requête → la liste se met à jour sans recharger la route.
 *
 * Sécurité : clé par merchantId ; l'action serveur applique les RLS (scope sur
 * le commerçant connecté) à chaque appel.
 */
export function CatalogLoader({
  merchantId,
  lowStockThreshold,
}: {
  merchantId: string;
  lowStockThreshold: number;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["merchant-catalog", merchantId];
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => fetchCatalog(),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  if (isPending && !data) {
    return (
      <div className="space-y-3 p-4 lg:p-6">
        <div className="bg-surface-3 h-10 w-64 animate-pulse rounded-md" />
        <div className="bg-surface-3 rounded-control h-10 w-full animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-3 h-16 w-full animate-pulse rounded-md"
          />
        ))}
      </div>
    );
  }

  if (data?.error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-control border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement du catalogue : {data.error}
        </div>
      </div>
    );
  }

  return (
    <CatalogView
      products={data?.products ?? []}
      categories={data?.categories ?? []}
      lowStockThreshold={lowStockThreshold}
      onMutated={() => queryClient.invalidateQueries({ queryKey })}
    />
  );
}
