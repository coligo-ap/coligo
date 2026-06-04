import { Suspense } from "react";
import {
  listMerchantCategories,
  listPublicMerchants,
  getPromoLabelsByMerchant,
} from "@/lib/data/merchants-public";
import { getActiveBanners } from "@/lib/data/promo-banners";
import { getMyReviewableOrders } from "@/lib/data/reviews";
import { loadRankingContext, rankMerchants } from "@/lib/data/merchant-ranking";
import { createClient } from "@/lib/supabase/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CategoryStrip } from "@/components/customer/category-strip";
import { HomeFilterPills } from "@/components/customer/home-filter-pills";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { LocationBanner } from "@/components/customer/location-banner";
import { MarketplaceSearchBar } from "@/components/customer/marketplace-search-bar";
import { MarketplaceGrid } from "@/components/customer/marketplace-grid";
import { PromoBanner } from "@/components/customer/promo-banner";
import { ReviewPrompt } from "@/components/customer/review-prompt";

export const dynamic = "force-dynamic";

// =============================================================================
// Accueil CLIENT — refonte style Uber Eats (version lancement).
// Header (zone + compte + panier) → recherche → catégories rondes → pilules →
// « Commerces près de toi ». Pas de grand hero violet, fond clair.
//
// Sections CONDITIONNELLES (jamais de bloc vide) :
//  - <PromoBanner> : rien tant qu'aucune campagne promo active (super-admin).
//  - "Commander à nouveau" : PAS au lancement (phase 2, si historique) — absent.
//  - Avis à laisser / top notés : seulement s'il y a du contenu.
// =============================================================================

export default async function CustomerHomePage() {
  const supabase = await createClient();
  const [fallback, categories, banners, reviewableOrders, { data: user }] =
    await Promise.all([
      listPublicMerchants({ limit: 24 }),
      listMerchantCategories(),
      getActiveBanners(),
      getMyReviewableOrders(1),
      supabase.auth.getUser(),
    ]);

  // Coords GPS du client connecté (pour la proximité dans le score de tri).
  let customerCoords: {
    latitude: number | null;
    longitude: number | null;
  } | null = null;
  if (user?.user) {
    const { data: customer } = await supabase
      .from("customers")
      .select("latitude, longitude")
      .eq("user_id", user.user.id)
      .maybeSingle();
    customerCoords = customer
      ? { latitude: customer.latitude, longitude: customer.longitude }
      : null;
  }

  // Contexte de classement (promoIds + orderCounts30d + poids + coords client).
  const rankingCtx = await loadRankingContext({
    merchantIds: fallback.map((m) => m.id),
    customer: customerCoords,
  });
  const promoIds = rankingCtx.promoIds;

  const promoLabels = await getPromoLabelsByMerchant(fallback.map((m) => m.id));
  const rankedFallback = rankMerchants(fallback, rankingCtx);

  return (
    <CustomerShell>
      {/* Auto-détection GPS au load (silencieuse si permission accordée). */}
      <LocationAutoDetect />

      <div className="bg-surface min-h-screen">
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6">
          {/* Recherche pleine largeur (sticky sous le header). */}
          <Suspense fallback={null}>
            <MarketplaceSearchBar />
          </Suspense>

          {/* Catégories rondes (mécanique Uber Eats). */}
          <div className="pt-1">
            <Suspense fallback={null}>
              <CategoryStrip categories={categories} />
            </Suspense>
          </div>

          {/* Pilules de filtres : Tous / Livraison / Express / Mieux notés. */}
          <div className="pt-3.5 pb-1">
            <Suspense fallback={null}>
              <HomeFilterPills />
            </Suspense>
          </div>

          {/* Localisation manuelle — fallback si la géoloc auto échoue. */}
          <LocationBanner />

          {/* Encart "Donne ton avis" — uniquement si commandes à noter. */}
          {reviewableOrders.length > 0 && (
            <section className="mt-3">
              <ReviewPrompt orders={reviewableOrders} />
            </section>
          )}

          {/* Bannière promo — rendue UNIQUEMENT si une campagne est active. */}
          <PromoBanner banners={banners} />

          {/* Commerces près de toi. */}
          <section className="mt-3 pb-8">
            <Suspense fallback={null}>
              <MarketplaceGrid
                fallback={rankedFallback}
                promoIds={promoIds}
                promoLabels={promoLabels}
              />
            </Suspense>
          </section>
        </div>
      </div>
    </CustomerShell>
  );
}
