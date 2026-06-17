"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDriverCompteSummary } from "@/app/(driver)/actions";
import { CompteView, type CompteData } from "./compte-view";

/**
 * Charge le RÉSUMÉ du compte (hero/stats/jauge) via TanStack Query (cache par
 * livreur). `seed` = données bon marché déjà connues côté serveur (nom, avatar,
 * statut) passées en placeholder → le hero s'affiche INSTANTANÉMENT dès la 1ʳᵉ
 * visite pendant que les stats réelles arrivent ; au retour, tout vient du cache.
 *
 * Les sections « Mes informations » (pièces/véhicule/versement, lourdes + URLs
 * signées) sont passées en `children` et streamées à part (Suspense) → elles ne
 * bloquent jamais l'affichage du résumé.
 */
export function CompteLoader({
  driverId,
  seed,
  children,
}: {
  driverId: string;
  seed: CompteData;
  children?: React.ReactNode;
}) {
  const { data } = useQuery({
    queryKey: ["driver-compte", driverId],
    queryFn: async () => (await fetchDriverCompteSummary()) ?? seed,
    // Affiche le seed (1re visite) ou les données précédentes (refetch) sans
    // jamais montrer d'écran vide.
    placeholderData: (prev) => prev ?? seed,
  });

  return <CompteView data={data ?? seed}>{children}</CompteView>;
}
