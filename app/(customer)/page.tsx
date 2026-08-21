import {
  listMerchantCategories,
  listPublicMerchants,
  getPromoLabelsByMerchant,
} from "@/lib/data/merchants-public";
import { getMyFavoriteIds } from "@/lib/data/favorites";
import {
  loadRankingContext,
  rankMerchants,
  splitOpenFirst,
} from "@/lib/data/merchant-ranking";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { MonoHome } from "@/components/customer/mono/mono-home";

export const dynamic = "force-dynamic";

// SEO — page d'entrée principale : titre marketing + canonique (les
// variantes ?utm/?q pointent toutes vers /).
export const metadata = {
  title: "Coligo — Courses, repas et commerces de proximité livrés en Algérie",
  description:
    "Commande auprès des commerçants près de chez toi : courses, repas, retrait sur place ou livraison rapide. Paiement en ligne (CIB/EDAHABIA, carte internationale) ou en espèces.",
  alternates: { canonical: "/" },
};

// =============================================================================
// Accueil CLIENT — refonte « bold minimalism » (branche dev), calquée sur la
// référence fastapp : adresse + recherche, rail de catégories détourées, puis
// des blocs de section alternés contenant des carrousels de cartes commerce.
//
// La page ne fait QUE les lectures : la présentation entière vit dans
// <MonoHome> (client), qui porte aussi l'en-tête et la barre du bas flottante
// — la coque client laisse « / » passer en mode bare.
//
// PROMOTIONS : plus de bandeau abstrait. Une promo appartient à un commerçant,
// donc elle s'affiche SUR sa carte, dans la section « Offres du jour ».
// =============================================================================

export default async function CustomerHomePage() {
  // Coords GPS du client connecté — critère géographique PRINCIPAL du SSR.
  // (Les visiteurs anon n'ont pas de coords serveur : MonoHome refait la
  // requête par proximité dès le montage avec la position du localStorage.)
  // Helpers mémoïsés (React cache) : partagés avec la coque, pas de double auth.
  const [, customer] = await Promise.all([
    getAuthUser(),
    getCurrentCustomerFull(),
  ]);
  const customerCoords: {
    latitude: number | null;
    longitude: number | null;
  } | null = customer
    ? { latitude: customer.latitude, longitude: customer.longitude }
    : null;
  const hasCoords =
    customerCoords?.latitude != null && customerCoords?.longitude != null;

  const [fallback, categories, favoriteIds] = await Promise.all([
    // Avec coords → liste déjà filtrée par rayon et triée par proximité.
    listPublicMerchants(
      hasCoords
        ? {
            latitude: customerCoords!.latitude,
            longitude: customerCoords!.longitude,
            limit: 24,
          }
        : { limit: 24 }
    ),
    listMerchantCategories(),
    getMyFavoriteIds(),
  ]);

  // Contexte de classement (promoIds + orderCounts30d + poids + coords client
  // + favoris) ET libellés promo : deux lectures INDÉPENDANTES (elles ne
  // dépendent que des ids commerçants déjà résolus, pas l'une de l'autre) → en
  // PARALLÈLE plutôt qu'en cascade, sur la page la plus fréquentée de l'app.
  const merchantIds = fallback.map((m) => m.id);
  const [rankingCtx, promoLabels] = await Promise.all([
    loadRankingContext({
      merchantIds,
      customer: customerCoords,
      favoriteIds,
    }),
    getPromoLabelsByMerchant(merchantIds),
  ]);
  // RANKING UNIFIÉ (mig 0261, façon Uber) : si activé, le score composite classe
  // TOUS les chemins — la distance (poids fort) départage avec la note, la
  // popularité, les promos et les favoris. Sinon, comportement legacy :
  //  - avec coords : liste déjà classée par proximité → on remonte les ouverts ;
  //  - sans coords : score composite (qualité/popularité/promo).
  const rankedFallback = rankingCtx.unified
    ? rankMerchants(fallback, rankingCtx)
    : hasCoords
      ? splitOpenFirst(fallback)
      : rankMerchants(fallback, rankingCtx);

  // REFONTE « bold minimalism » (branche dev) : l'accueil rend sa propre coque
  // (en-tête, rail, sections, barre du bas flottante) — la coque client la
  // laisse passer en « bare ». Les données restent EXACTEMENT les mêmes.
  return (
    <>
      <LocationAutoDetect />
      <MonoHome
        merchants={rankedFallback}
        categories={categories}
        promoLabels={promoLabels}
      />
    </>
  );
}
