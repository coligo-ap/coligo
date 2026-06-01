import { notFound } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getPublicMerchantBySlug } from "@/lib/data/merchants-public";
import {
  listMerchantProducts,
  listMerchantPromotions,
} from "@/lib/data/customer-catalog";
import { WILAYAS } from "@/lib/config/wilayas";
import { MerchantCompactHeader } from "@/components/customer/merchant-compact-header";
import { MerchantCatalog } from "@/components/customer/merchant-catalog";
import { MerchantCartCta } from "@/components/customer/merchant-cart-cta";
import { MerchantClosedNotice } from "@/components/customer/merchant-closed-notice";
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
  const m = await getPublicMerchantBySlug(slug);
  if (!m) notFound();

  // Charge les avis publics du commerçant (RLS filtre déjà is_hidden=false).
  const reviews = await getMerchantReviews(m.id, 20);

  const [catalog, promotions] = await Promise.all([
    listMerchantProducts(m.id),
    listMerchantPromotions(m.id),
  ]);

  const wilayaName = m.wilaya_code
    ? (WILAYAS.find((w) => w.code === m.wilaya_code)?.name ?? null)
    : null;

  // Meilleur prix promo unitaire par produit (la meilleure remise produit).
  const now = new Date();
  const productPromos = promotions.filter(
    (p) =>
      p.type === "product_discount" &&
      isPromotionActive(
        {
          status: p.status,
          startsAt: p.starts_at,
          endsAt: p.ends_at,
        },
        now
      )
  );
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

  return (
    <CustomerShell>
      <div className="mx-auto max-w-[1100px] px-4 pt-4 pb-4 lg:px-6 lg:pt-6 lg:pb-8">
        {/* En-tête compact style Uber Eats : cover plate + 2 boutons ronds
            par-dessus + bande d'infos compacte sous la cover (3 lignes max).
            Le bouton "Retour" est intégré sur la cover — plus de ligne séparée. */}
        <MerchantCompactHeader
          merchantId={m.id}
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
          rating_avg={m.rating_avg}
          rating_count={m.rating_count}
          reviews={reviews}
        />

        {/* Bandeau + pop-up « fermé / en pause » → propose de programmer une
            commande pour plus tard (façon Deliveroo / Uber Eats). */}
        <div className="mt-5">
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
        <div className="mt-5 pb-32 lg:pb-12">
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
          />
        </div>
      </div>

      {/* CTA panier sticky en bas (mobile + desktop), si panier de ce commerce */}
      <MerchantCartCta merchantId={m.id} />
    </CustomerShell>
  );
}
