import { notFound } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getMyFavoriteIds } from "@/lib/data/favorites";
import { getPublicMerchantBySlug } from "@/lib/data/merchants-public";
import {
  listMerchantProducts,
  listMerchantPromotions,
} from "@/lib/data/customer-catalog";
import { WILAYAS } from "@/lib/config/wilayas";
import { MerchantCompactHeader } from "@/components/customer/merchant-compact-header";
import { MerchantCatalog } from "@/components/customer/merchant-catalog";
import { CatalogViewToggle } from "@/components/customer/catalog-view-toggle";
import { MerchantOffersRail } from "@/components/customer/merchant-offers-rail";
import { MerchantCartCta } from "@/components/customer/merchant-cart-cta";
import { MerchantClosedNotice } from "@/components/customer/merchant-closed-notice";
import { ShopModeToggle } from "@/components/customer/shop-mode-toggle";
import { getMerchantReviews } from "@/lib/data/reviews";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import {
  discountedUnitPrice,
  isPromotionActive,
} from "@/lib/promotions/engine";
import { rankPromotions } from "@/lib/promotions/ranking";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

export default async function MerchantPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await getPublicMerchantBySlug(slug);
  if (!m) notFound();

  // Charge les avis publics du commerçant (RLS filtre déjà is_hidden=false).
  const reviews = await getMerchantReviews(m.id, 20);

  const supabase = await createClient();
  const [catalog, promotions, favoriteIds, { data: authData }, flags] =
    await Promise.all([
      listMerchantProducts(m.id),
      listMerchantPromotions(m.id),
      getMyFavoriteIds(),
      supabase.auth.getUser(),
      getFeatureFlags(),
    ]);
  const isAuth = !!authData?.user;
  const isFavorite = favoriteIds.has(m.id);

  const wilayaName = m.wilaya_code
    ? (WILAYAS.find((w) => w.code === m.wilaya_code)?.name ?? null)
    : null;

  // Promotions actives, ventilées par type (statut effectif calculé à la lecture).
  const now = new Date();
  const activePromos = promotions.filter((p) =>
    isPromotionActive(
      { status: p.status, startsAt: p.starts_at, endsAt: p.ends_at },
      now
    )
  );
  // Réductions PRODUIT (prix barré en ligne dans le catalogue) : classique +
  // vente flash + anti-gaspillage (toutes des réductions produit, mig 0331/0333).
  const productPromos = activePromos.filter(
    (p) =>
      p.type === "product_discount" ||
      p.type === "flash_sale" ||
      p.type === "anti_gaspillage"
  );
  const quantityPromos = activePromos.filter(
    (p) => p.type === "quantity_offer"
  );

  // Carrousel d'OFFRES compact & classé (codes, cadeaux, livraison offerte,
  // ventes flash, anti-gaspi) — mig 0333. Réductions produit « simples » gardent
  // leurs carrousels de produits (ci-dessous), pas de doublon.
  const railOffers = rankPromotions(
    activePromos.filter(
      (p) =>
        p.type === "promo_code" ||
        p.type === "free_gift" ||
        p.type === "free_delivery" ||
        p.type === "flash_sale" ||
        p.type === "anti_gaspillage"
    )
  );

  // Meilleur prix promo unitaire par produit (la meilleure remise produit).
  const promoPriceById: Record<string, number> = {};
  for (const product of catalog.products) {
    let best = product.price_da;
    for (const promo of productPromos) {
      if (!promo.product_ids.includes(product.id)) continue;
      if (!promo.discount_kind || promo.discount_value == null) continue;
      const candidate = discountedUnitPrice(
        product.price_da,
        promo.discount_kind,
        promo.discount_value,
        APP_CONFIG.promotions.minPriceDa
      );
      if (candidate < best) best = candidate;
    }
    if (best < product.price_da) promoPriceById[product.id] = best;
  }

  // Offre quantité par produit (la plus généreuse : plus d'unités offertes par
  // groupe). Sert au libellé rouge « X achetés + Y offert(s) » sur les cartes.
  const quantityOfferByProduct: Record<string, { buy: number; get: number }> =
    {};
  for (const promo of quantityPromos) {
    if (!promo.buy_qty || !promo.get_qty) continue;
    for (const pid of promo.product_ids) {
      const prev = quantityOfferByProduct[pid];
      const ratio = promo.get_qty / (promo.buy_qty + promo.get_qty);
      const prevRatio = prev ? prev.get / (prev.buy + prev.get) : -1;
      if (ratio > prevRatio) {
        quantityOfferByProduct[pid] = {
          buy: promo.buy_qty,
          get: promo.get_qty,
        };
      }
    }
  }

  // Carrousels de RÉDUCTION produit « simple » (par promo). Les ventes flash /
  // anti-gaspi sont dans le carrousel d'offres (railOffers) → pas de doublon ici.
  const promoCarousels = activePromos.filter(
    (p) => p.type === "product_discount"
  );

  // Produits COMPLETS indexés (feuille de détail d'une offre : affichage +
  // AJOUT PANIER direct — la garde options/poids a besoin de tout le produit).
  // Borné aux produits RÉFÉRENCÉS par les offres du rail (payload minimal).
  const railProductIds = new Set(railOffers.flatMap((o) => o.product_ids));
  const productsById = Object.fromEntries(
    catalog.products
      .filter((p) => railProductIds.has(p.id))
      .map((p) => [p.id, p])
  );

  return (
    // hideHeader : la fiche porte sa propre topbar fixe (← retour · ♡ · panier)
    // posée sur le hero immersif, donc on masque le header global du shell.
    <CustomerShell hideHeader>
      {/* Fond BLANC pur sur toute la fiche (style Bolt Food) — le gris clair
          global (bg-surface-2 du chrome) reste sur les autres pages. */}
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-4 lg:px-6 lg:pt-6 lg:pb-8">
          {/* En-tête compact style Uber Eats : cover plate + 2 boutons ronds
            par-dessus + bande d'infos compacte sous la cover (3 lignes max).
            Le bouton "Retour" est intégré sur la cover — plus de ligne séparée. */}
          <MerchantCompactHeader
            merchantId={m.id}
            initialFavorite={isFavorite}
            isAuth={isAuth}
            name={m.name}
            category={m.category}
            description_fr={m.description_fr}
            description_ar={m.description_ar}
            cover_url={m.cover_url}
            logo_url={m.logo_url}
            commune={m.commune}
            wilaya_name={wilayaName}
            min_order_da={m.min_order_da}
            prep_time_min={m.prep_time_min}
            opening_hours={m.opening_hours}
            pause={{
              orders_paused: m.orders_paused,
              paused_until: m.paused_until,
              closure_start: m.closure_start,
              closure_end: m.closure_end,
            }}
            rating_avg={m.rating_avg}
            rating_count={m.rating_count}
            reviews={reviews}
            tags={m.tags}
            barcode_scan_enabled={flags.barcode_merchant.status === "active"}
            phone_public={m.phone_public}
            address={m.address}
            latitude={m.latitude}
            longitude={m.longitude}
            delivery_enabled={!!m.delivery_enabled}
            express_enabled={!!m.express_enabled}
            tours_enabled={!!m.tours_enabled}
            accepts_cash={!!m.accepts_cash}
            accepts_online={!!m.accepts_online}
            delivery_radius_km={m.delivery_radius_km}
          />

          {/* Offres & réductions — carrousel COMPACT et CLASSÉ (codes, cadeaux,
            livraison offerte, ventes flash à compte à rebours, anti-gaspi).
            Une seule bande, pas d'empilement de cartes → visuel épuré. */}
          {railOffers.length > 0 && (
            <div className="mt-3">
              <MerchantOffersRail
                merchant={{
                  id: m.id,
                  slug: m.slug,
                  name: m.name,
                  logo_url: m.logo_url,
                }}
                offers={railOffers}
                productsById={productsById}
                promoPriceById={promoPriceById}
              />
            </div>
          )}

          {/* Retrait/Livraison + bascule liste/catégories sur la MÊME ligne
            (gain de place). La bascule pilote le catalogue via un store
            partagé et se masque s'il n'y a qu'un groupe. */}
          <div className="mt-3 flex items-stretch gap-2">
            <div className="min-w-0 flex-1">
              <ShopModeToggle
                merchant={{
                  id: m.id,
                  slug: m.slug,
                  name: m.name,
                  logo_url: m.logo_url,
                }}
                deliveryEnabled={!!m.delivery_enabled}
              />
            </div>
            <CatalogViewToggle
              merchantId={m.id}
              defaultDisplay={m.catalog_display}
            />
          </div>

          {/* Bandeau + pop-up « fermé / en pause » → propose de programmer une
            commande pour plus tard (façon Deliveroo / Uber Eats). */}
          <div className="mt-3">
            <MerchantClosedNotice
              openingHours={m.opening_hours}
              maxDaysAhead={m.max_days_ahead}
              pause={{
                orders_paused: m.orders_paused,
                paused_until: m.paused_until,
                closure_start: m.closure_start,
                closure_end: m.closure_end,
              }}
            />
          </div>

          {/* Catalogue : chips sticky + sections produits en lignes compactes
            (image 64px à gauche, prix violet, bouton + à droite). */}
          <div className="mt-4 pb-32 lg:pb-12">
            <MerchantCatalog
              merchant={{
                id: m.id,
                slug: m.slug,
                name: m.name,
                logo_url: m.logo_url,
              }}
              products={catalog.products}
              categories={catalog.categories}
              promoPriceById={promoPriceById}
              quantityOfferByProduct={quantityOfferByProduct}
              promoCarousels={promoCarousels}
              defaultDisplay={m.catalog_display}
            />
          </div>
        </div>

        {/* CTA panier sticky en bas (mobile + desktop), si panier de ce commerce */}
        <MerchantCartCta merchantId={m.id} minOrderDa={m.min_order_da} />
      </div>
    </CustomerShell>
  );
}
