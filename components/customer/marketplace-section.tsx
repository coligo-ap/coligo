"use client";

import { useSearchParams } from "next/navigation";
import { MarketplaceGrid } from "@/components/customer/marketplace-grid";
import { ProductSearchResults } from "@/components/customer/product-search-results";
import type { PublicMerchant, PromoLabel } from "@/lib/data/merchants-public";

// =============================================================================
// Bascule la zone principale de l'accueil : dès qu'une recherche (q) est
// active, on montre la RECHERCHE PAR PRODUIT (commerçants + carrousels de
// produits, volet 2). Sans recherche, la grille de commerces habituelle.
// =============================================================================

type Props = {
  fallback: PublicMerchant[];
  promoIds?: Set<string>;
  promoLabels?: Record<string, PromoLabel>;
  favoriteIds?: Set<string>;
  isAuth?: boolean;
};

export function MarketplaceSection(props: Props) {
  const q = (useSearchParams().get("q") ?? "").trim();
  if (q.length >= 2) return <ProductSearchResults />;
  return <MarketplaceGrid {...props} />;
}
