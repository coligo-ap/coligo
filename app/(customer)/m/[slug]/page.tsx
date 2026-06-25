import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Tag } from "lucide-react";
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
import { MerchantPromoCodes } from "@/components/customer/merchant-promo-codes";
import { MerchantCartCta } from "@/components/customer/merchant-cart-cta";
import { MerchantClosedNotice } from "@/components/customer/merchant-closed-notice";
import { ShopModeToggle } from "@/components/customer/shop-mode-toggle";
import { getMerchantReviews } from "@/lib/data/reviews";
import {
  discountedUnitPrice,
  isPromotionActive,
} from "@/lib/promotions/engine";
import { APP_CONFIG } from "@/lib/config/app-config";

export const dynamic = "force-dynamic";

export default async function MerchantPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("merchant");
  const m = await getPublicMerchantBySlug(slug);
  if (!m) notFound();

  // Charge les avis publics du commerçant (RLS filtre déjà is_hidden=false).
  const reviews = await getMerchantReviews(m.id, 20);

  const supabase = await createClient();
  const [catalog, promotions, favoriteIds, { data: authData }] =
    await Promise.all([
      listMerchantProducts(m.id),
      listMerchantPromotions(m.id),
      getMyFavoriteIds(),
      supabase.auth.getUser(),
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
  const productPromos = activePromos.filter(
    (p) => p.type === "product_discount"
  );
  const quantityPromos = activePromos.filter(
    (p) => p.type === "quantity_offer"
  );
  const promoCodes = activePromos.filter((p) => p.type === "promo_code");

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

  // Carrousels de RÉDUCTION produit (par promo). Les offres quantité ont leur
  // propre carrousel dédié « Achat offert » (via quantityOfferByProduct), et les
  // codes promo n'ont pas de produits → carte dédiée. Pas de doublon.
  const promoCarousels = productPromos;

  return (
    // hideHeader : la fiche porte sa propre topbar fixe (← retour · ♡ · panier)
    // posée sur le hero immersif, donc on masque le header global du shell.
    <CustomerShell hideHeader>
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
        />

        {/* Codes promo de la boutique — carte attractive (entre les stats du
            commerce et le choix Retrait/Livraison). Copie au clic + conditions. */}
        {promoCodes.length > 0 && (
          <div className="mt-3">
            <MerchantPromoCodes promotions={promoCodes} />
          </div>
        )}

        {/* Choix Retrait / Livraison dès la fiche (persisté → pré-rempli au
            checkout). + Bannière promo si des produits sont en réduction. */}
        <div className="mt-3 space-y-2.5">
          <ShopModeToggle
            merchant={{
              id: m.id,
              slug: m.slug,
              name: m.name,
              logo_url: m.logo_url,
            }}
            deliveryEnabled={!!m.delivery_enabled}
          />
          {Object.keys(promoPriceById).length > 0 && (
            <div className="bg-warning-50 flex items-center gap-3 rounded-[14px] p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#E0902A] to-[#C77A18] text-white">
                <Tag className="size-5" />
              </span>
              <p className="text-[13px] font-bold text-[#7A4E10]">
                {t("promoBanner")}
              </p>
            </div>
          )}
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
          />
        </div>
      </div>

      {/* CTA panier sticky en bas (mobile + desktop), si panier de ce commerce */}
      <MerchantCartCta merchantId={m.id} />
    </CustomerShell>
  );
}
