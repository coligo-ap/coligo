import { Suspense } from "react";
import {
  listMerchantCategories,
  listPublicMerchants,
} from "@/lib/data/merchants-public";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CategoryStrip } from "@/components/customer/category-strip";
import { LocationBanner } from "@/components/customer/location-banner";
import { MerchantsByZone } from "@/components/customer/merchants-by-zone";

export const dynamic = "force-dynamic";

export default async function CustomerHomePage() {
  // Côté serveur on n'a pas accès au localStorage → on charge un FALLBACK
  // « tous les commerces actifs » (limité). Le composant client `MerchantsByZone`
  // filtre/rafraîchit la liste selon la zone choisie côté navigateur.
  const [fallback, categories] = await Promise.all([
    listPublicMerchants({ limit: 24 }),
    listMerchantCategories(),
  ]);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-6 lg:py-8">
        <LocationBanner />

        {/* Hero desktop uniquement */}
        <section className="from-primary-600 via-primary-700 to-primary-800 mb-8 hidden overflow-hidden rounded-[20px] bg-gradient-to-br p-10 text-white shadow-sm lg:block">
          <div className="max-w-xl">
            <h1 className="text-4xl leading-tight font-bold">
              Tes commerces de quartier,
              <br />
              en un clic.
            </h1>
            <p className="text-primary-50/90 mt-3 text-lg">
              Commande à l&apos;avance, paye en ligne ou sur place, récupère
              sans faire la queue.
            </p>
          </div>
        </section>

        {/* Catégories */}
        {categories.length > 0 && (
          <section className="mb-6 lg:mb-10">
            <h2 className="text-foreground mb-3 text-base font-bold lg:text-xl">
              Catégories
            </h2>
            <CategoryStrip categories={categories} />
          </section>
        )}

        {/* Liste filtrée par zone (client-side) */}
        <section>
          <Suspense fallback={null}>
            <MerchantsByZone fallback={fallback} />
          </Suspense>
        </section>
      </div>
    </CustomerShell>
  );
}
