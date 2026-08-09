import { cookies } from "next/headers";
import {
  listMerchantCategories,
  listPublicMerchants,
  getPromoLabelsByMerchant,
} from "@/lib/data/merchants-public";
import {
  getActiveBanners,
  type BannerViewerLocation,
} from "@/lib/data/promo-banners";
import {
  LOCATION_COOKIE,
  parseLocationCookie,
} from "@/lib/customer/location-cookie";
import { getMyFavoriteIds } from "@/lib/data/favorites";
import { getMyReviewableOrders } from "@/lib/data/reviews";
import {
  loadRankingContext,
  rankMerchants,
  splitOpenFirst,
} from "@/lib/data/merchant-ranking";
import { getLocale } from "next-intl/server";
import { getAuthUser } from "@/lib/auth/session";
import { getEffectiveFlags } from "@/lib/data/feature-flags";
import { getAppTheme } from "@/lib/data/app-theme";
import { getCurrentCustomerFull } from "@/lib/auth/customer";
import { InstallAppBanner } from "@/components/shared/install-app-banner";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CategoryStrip } from "@/components/customer/category-strip";
import { LocationAutoDetect } from "@/components/customer/location-auto-detect";
import { LocationBanner } from "@/components/customer/location-banner";
import { MarketplaceSearchBar } from "@/components/customer/marketplace-search-bar";
import { MarketplaceSection } from "@/components/customer/marketplace-section";
import { PromoBanner } from "@/components/customer/promo-banner";
import { HomeWheelEntry } from "@/components/customer/home-wheel-entry";
import { WheelBubble } from "@/components/customer/wheel/wheel-bubble";
import { ReviewPrompt } from "@/components/customer/review-prompt";
import {
  HomeThemeHero,
  shouldShowThemeStrip,
} from "@/components/customer/home-theme-hero";

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
  // Coords GPS du client connecté — critère géographique PRINCIPAL du SSR.
  // (Les visiteurs anon n'ont pas de coords serveur : la grille refait la
  // requête par proximité dès le montage avec la position du localStorage.)
  // Session + profil mémoïsés (partagés avec CustomerShell → pas de double auth).
  // Flags mémoïsés aussi (React cache — déjà lus par le layout).
  const [authUser, customer, flags, appTheme, locale] = await Promise.all([
    getAuthUser(),
    getCurrentCustomerFull(),
    getEffectiveFlags(),
    // Bandeau « occasion » optionnel (mig 0415, piloté /admin/controle) —
    // lecture en cache (tag app-theme), coût nul en pratique.
    getAppTheme(),
    getLocale(),
  ]);
  const isAuth = !!authUser;
  const customerCoords: {
    latitude: number | null;
    longitude: number | null;
  } | null = customer
    ? { latitude: customer.latitude, longitude: customer.longitude }
    : null;
  const hasCoords =
    customerCoords?.latitude != null && customerCoords?.longitude != null;

  // Position pour le CIBLAGE DES BANNIÈRES, filtrée CÔTÉ SERVEUR (comme Uber/
  // Bolt) : on lit d'abord le cookie miroir de la position LIVE du navigateur
  // (écrit par writeStoredLocation) → le SSR renvoie déjà la bonne bannière, sans
  // afficher puis retirer celle d'une autre ville ni refaire une requête client.
  // Repli : adresse enregistrée du client connecté (puis rien = bannières
  // globales pour un visiteur sans position).
  const cookieLoc = parseLocationCookie(
    (await cookies()).get(LOCATION_COOKIE)?.value
  );
  const bannerLoc: BannerViewerLocation = cookieLoc ?? {
    lat: customerCoords?.latitude ?? null,
    lng: customerCoords?.longitude ?? null,
    wilaya: customer?.default_wilaya_code ?? null,
    commune: customer?.default_commune ?? null,
  };

  const [fallback, categories, banners, reviewableOrders, favoriteIds] =
    await Promise.all([
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
      // Ciblage par ZONE côté serveur avec la position live (cookie) — repli
      // adresse enregistrée. Bannières sans zone = globales ; visiteur sans
      // position = globales seulement.
      getActiveBanners(bannerLoc),
      getMyReviewableOrders(1),
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
  const promoIds = rankingCtx.promoIds;
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

  return (
    <CustomerShell>
      {/* Auto-détection GPS au load (silencieuse si permission accordée). */}
      <LocationAutoDetect />

      <div className="bg-surface min-h-screen">
        {/* Bande « occasion » — UNE LIGNE qui prolonge le header peint en g1
            par la coque (mig 0415/0416, activée par le super-admin). Masquée
            pour un connecté sur le thème par défaut : « Bienvenue sur Coligo »
            est du décor pour quelqu'un qui est déjà entré. */}
        {appTheme.marketplaceHero &&
          shouldShowThemeStrip({ theme: appTheme.theme, isAuth }) && (
            <HomeThemeHero theme={appTheme.theme} locale={locale} />
          )}
        <div className="mx-auto max-w-[1400px] px-4 lg:px-6">
          {/* ─── STRATE 1 — RECHERCHE (+ filtres, + scan si le flag
              barcode_marketplace est actif). Zone neutre, collée au header. */}
          <MarketplaceSearchBar
            scanEnabled={flags.barcode_marketplace.status === "active"}
          />

          {/* Visiteur sur le WEB MOBILE : proposition d'installer l'app, vers
              la boutique de SON appareil. Invisible dans l'app native, sur
              ordinateur, et après un refus. */}
          <InstallAppBanner />

          {/* ─── STRATE 2 — CATÉGORIES. Le filtre appliqué se voit par sa
              COULEUR (tuile cerclée violet), jamais par un bandeau en plus. */}
          <CategoryStrip categories={categories} />

          {/* Localisation manuelle — fallback si la géoloc auto échoue. */}
          <LocationBanner />

          {/* Encart "Donne ton avis" — uniquement si commandes à noter. */}
          {reviewableOrders.length > 0 && (
            <section className="mt-section">
              <ReviewPrompt orders={reviewableOrders} />
            </section>
          )}

          {/* Roue Coligo — entrée ANIMÉE (style Temu) : client connecté ET
              roue active seulement (flag déjà lu, zéro fetch en plus). Le
              tirage reste 100 % serveur : ce bandeau n'est qu'un lien. */}
          {isAuth &&
            flags.wheel.status === "active" &&
            banners.length === 0 && (
              <section className="mt-section">
                <HomeWheelEntry />
              </section>
            )}

          {/* Bannière promo — rendue UNIQUEMENT si une campagne est active.
              On transmet la position utilisée par le SSR : côté client, la
              position LIVE du navigateur (location-store, MÊME source que la
              liste des commerces) PRIME dès qu'elle diffère → un client à
              Béjaïa ne voit jamais les offres d'Alger restées dans son adresse
              enregistrée. Si live == SSR, aucun refetch (cache d'abord). */}
          <PromoBanner banners={banners} ssrLocation={bannerLoc} />

          {/* Roue en BULLE FLOTTANTE quand des bannières marketing occupent
              déjà la place : elle flotte au-dessus du contenu au lieu de
              pousser les commerces vers le bas. Uniquement sur l'accueil. */}
          {isAuth && flags.wheel.status === "active" && banners.length > 0 && (
            <WheelBubble />
          )}

          {/* Commerces près de toi. */}
          {/* ⚠️ PAS de <Suspense fallback={null}> autour de ces blocs (ni des
              trois du dessus) : en PROD, plusieurs frontières sœurs streamées
              avec fallback null provoquaient des erreurs d'hydratation
              React #418/#310 dès qu'un paramètre de filtre était dans l'URL
              (bug d'alignement dépendant de la COMPOSITION des enfants, pas du
              contenu — bissection du 13/07/2026). La page est force-dynamic :
              la frontière de route loading.tsx couvre déjà le streaming, et
              useSearchParams n'exige un Suspense qu'en rendu STATIQUE. */}
          {/* ─── STRATE 3 — CONTENU. */}
          <section className="mt-section pb-8">
            <MarketplaceSection
              fallback={rankedFallback}
              promoIds={promoIds}
              promoLabels={promoLabels}
              favoriteIds={favoriteIds}
              isAuth={isAuth}
              unified={rankingCtx.unified}
            />
          </section>
        </div>
      </div>
    </CustomerShell>
  );
}
