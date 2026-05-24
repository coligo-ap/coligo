import { Suspense } from "react";
import {
  listMerchantCategories,
  listMerchantIdsWithActivePromo,
  listPublicMerchants,
} from "@/lib/data/merchants-public";
import { getActiveBanners } from "@/lib/data/promo-banners";
import { getMyReviewableOrders } from "@/lib/data/reviews";
import { createClient } from "@/lib/supabase/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CategoryStrip } from "@/components/customer/category-strip";
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
      getMyReviewableOrders(3),
      supabase.auth.getUser(),
    ]);

  // Prénom du client connecté pour le hero (optionnel).
  let firstName: string | null = null;
  if (user?.user) {
    const { data: customer } = await supabase
      .from("customers")
      .select("full_name")
      .eq("user_id", user.user.id)
      .maybeSingle();
    firstName = customer?.full_name?.split(" ")[0] ?? null;
  }

  // IDs des commerces avec promo active — alimentent le badge PROMO sur les
  // cards ET le carrousel « Populaires près de toi ».
  const promoIds = await listMerchantIdsWithActivePromo(
    fallback.map((m) => m.id)
  );

  // Populaires : commerces ayant une promo active dans le fallback. Si aucun,
  // section masquée. Tri par récence (déjà ordre `listPublicMerchants`).
  const popular = fallback.filter((m) => promoIds.has(m.id)).slice(0, 12);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-8">
        {/* Hero violet — salutation + localisation. */}
        <StorefrontHero firstName={firstName} />

        {/* Barre de recherche sticky sous le hero. */}
        <Suspense fallback={null}>
          <MarketplaceSearchBar categories={categories} />
        </Suspense>

        {/* Localisation legacy — on garde le banner GPS-prompt pour MVP. */}
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

        {/* Populaires (commerces avec promo active). */}
        {popular.length > 0 && (
          <section className="mt-8">
            <MerchantCarousel merchants={popular} promoIds={promoIds} />
          </section>
        )}

        {/* Tous les commerces (filtre serveur via URL params + tri ouverts d'abord). */}
        <section className="mt-8">
          <Suspense fallback={null}>
            <MarketplaceGrid fallback={fallback} promoIds={promoIds} />
          </Suspense>
        </section>
      </div>
    </CustomerShell>
  );
}
