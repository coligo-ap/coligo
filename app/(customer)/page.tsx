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
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { LocationBanner } from "@/components/customer/location-banner";
import { MarketplaceSearchBar } from "@/components/customer/marketplace-search-bar";
import { MarketplaceGrid } from "@/components/customer/marketplace-grid";
import { MerchantCarousel } from "@/components/customer/merchant-carousel";
import { PromoBannerCarousel } from "@/components/customer/promo-banner-carousel";
import { ReviewPrompt } from "@/components/customer/review-prompt";
import { StorefrontHero } from "@/components/customer/storefront-hero";

export const dynamic = "force-dynamic";

export default async function CustomerHomePage() {
  // Server-side : on charge en parallèle tout ce dont on a besoin pour rendre
  // la home sans flash. Le fallback `merchants` est "tous les commerces
  // actifs" — la grille filtre par zone côté client (location-store).
  const supabase = await createClient();
  const [fallback, categories, banners, reviewableOrders, { data: user }] =
    await Promise.all([
      listPublicMerchants({ limit: 24 }),
      listMerchantCategories(),
      getActiveBanners(),
      // 1 seul avis sur la home : on ne sature pas. Les autres commandes à
      // noter sont accessibles via /commandes (bouton "Laisser un avis").
      getMyReviewableOrders(1),
      supabase.auth.getUser(),
    ]);

  // Prénom + coords GPS du client connecté (pour proximité dans le score).
  let firstName: string | null = null;
  let customerCoords: {
    latitude: number | null;
    longitude: number | null;
  } | null = null;
  if (user?.user) {
    const { data: customer } = await supabase
      .from("customers")
      .select("full_name, latitude, longitude")
      .eq("user_id", user.user.id)
      .maybeSingle();
    firstName = customer?.full_name?.split(" ")[0] ?? null;
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

  // Détails des promos (− %, code, offre) pour les mettre en avant sur les
  // cartes — pas seulement un badge "PROMO" générique.
  const promoLabels = await getPromoLabelsByMerchant(fallback.map((m) => m.id));

  // Carrousel « Top notés » : note >= 4 ET au moins 5 avis. Tri par score.
  const topRated = rankMerchants(
    fallback.filter((m) => m.rating_avg >= 4 && m.rating_count >= 5),
    rankingCtx
  ).slice(0, 12);

  // Pré-tri du fallback côté serveur (la grille re-trie après fetch zone).
  const rankedFallback = rankMerchants(fallback, rankingCtx);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-8">
        {/* Hero violet — salutation seule. La nav (logo+location+cart+profile)
            est désormais portée par le CustomerHeader sticky du shell. */}
        <StorefrontHero firstName={firstName} />

        {/* Barre de recherche sticky sous le hero. */}
        <Suspense fallback={null}>
          <MarketplaceSearchBar categories={categories} />
        </Suspense>

        {/* Auto-détection GPS au load (silencieuse si permission accordée).
            Si elle réussit, le bandeau ci-dessous ne s'affiche jamais. */}
        <LocationAutoDetect />

        {/* Localisation legacy — fallback manuel si la géoloc auto échoue. */}
        <LocationBanner />

        {/* Encart "Donne ton avis" — uniquement si commandes completed sans
            avis. Disparaît dès qu'elles sont toutes notées. */}
        {reviewableOrders.length > 0 && (
          <section className="mt-4">
            <ReviewPrompt orders={reviewableOrders} />
          </section>
        )}

        {/* Bannières éditoriales (carrousel). */}
        {banners.length > 0 && (
          <section className="mt-4">
            <PromoBannerCarousel banners={banners} />
          </section>
        )}

        {/* Catégories — bulles rondes scrollables horizontalement. */}
        <section className="mt-6">
          <h2 className="font-display text-foreground mb-3 px-1 text-base font-bold lg:text-lg">
            Catégories
          </h2>
          <CategoryStrip categories={categories} />
        </section>

        {/* Top notés : note >= 4 et au moins 5 avis. Section masquée tant
            qu'aucun commerce ne remplit ces critères (= début de vie de la
            plateforme). */}
        {topRated.length > 0 && (
          <section className="mt-8">
            <MerchantCarousel
              merchants={topRated}
              promoIds={promoIds}
              promoLabels={promoLabels}
            />
          </section>
        )}

        {/* Tous les commerces — pré-trié par score composite côté serveur. */}
        <section className="mt-8">
          <Suspense fallback={null}>
            <MarketplaceGrid
              fallback={rankedFallback}
              promoIds={promoIds}
              promoLabels={promoLabels}
            />
          </Suspense>
        </section>
      </div>
    </CustomerShell>
  );
}
