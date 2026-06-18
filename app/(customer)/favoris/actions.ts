"use server";

import { getFavoriteMerchants } from "@/lib/data/favorites";
import type { PublicMerchant } from "@/lib/data/merchants-public";

/**
 * Commerces favoris du client connecté (loader TanStack `/favoris`). Simple
 * relais de `getFavoriteMerchants()` (ré-auth + RLS à chaque appel) pour qu'il
 * soit appelable depuis un composant client via useQuery.
 */
export async function fetchFavoriteMerchants(): Promise<PublicMerchant[]> {
  return getFavoriteMerchants();
}
