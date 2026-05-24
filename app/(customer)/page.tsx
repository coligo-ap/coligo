import { Suspense } from "react";
import {
  listMerchantCategories,
  listPublicMerchants,
} from "@/lib/data/merchants-public";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CategoryStrip } from "@/components/customer/category-strip";
import { LocationBanner } from "@/components/customer/location-banner";
import { MarketplaceView } from "@/components/customer/marketplace-view";
import { ImageWithOverlay } from "@/components/ui/image-with-overlay";

export const dynamic = "force-dynamic";

export default async function CustomerHomePage() {
  // Côté serveur on n'a pas accès au localStorage → on charge un FALLBACK
  // « tous les commerces actifs » (limité). Le composant client
  // `MarketplaceView` filtre/rafraîchit selon la zone + les filtres recherche.
  const [fallback, categories] = await Promise.all([
    listPublicMerchants({ limit: 24 }),
    listMerchantCategories(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-8">
        <LocationBanner />

        {/* Hero desktop uniquement — photo de qualité + overlay dégradé. */}
        <section className="mb-8 hidden overflow-hidden rounded-[20px] shadow-sm lg:block">
          <ImageWithOverlay
            src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600&auto=format"
            alt="Étal coloré d'un commerce de proximité"
            variant="hero"
            aspectClassName="aspect-[21/8]"
            priority
            childrenPosition="bottom"
          >
            <div className="max-w-xl pb-2">
              <h1 className="text-4xl leading-tight font-bold drop-shadow">
                Tes commerces de quartier,
                <br />
                en un clic.
              </h1>
              <p className="mt-3 text-lg text-white/90">
                Commande à l&apos;avance, paye en ligne ou sur place, récupère
                sans faire la queue.
              </p>
            </div>
          </ImageWithOverlay>
        </section>

        {/* Catégories — Supérette + Boulangerie + Boucherie + Tous épinglées
            en tête, autres catégories DB ensuite. */}
        <section className="mb-6 lg:mb-10">
          <h2 className="text-foreground mb-3 text-base font-bold lg:text-xl">
            Catégories
          </h2>
          <CategoryStrip categories={categories} />
        </section>

        {/* Recherche + filtres + liste, en place (plus de page /search). */}
        <section>
          <Suspense fallback={null}>
            <MarketplaceView fallback={fallback} categories={categories} />
          </Suspense>
        </section>
      </div>
    </CustomerShell>
  );
}
