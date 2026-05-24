import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getPublicMerchantBySlug } from "@/lib/data/merchants-public";
import {
  listMerchantProducts,
  listMerchantPromotions,
} from "@/lib/data/customer-catalog";
import { WILAYAS } from "@/lib/config/wilayas";
import { MerchantHeroCard } from "@/components/customer/merchant-hero-card";
import { MerchantCatalog } from "@/components/customer/merchant-catalog";
import { MerchantCartCta } from "@/components/customer/merchant-cart-cta";
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
      <div className="mx-auto max-w-[1100px] px-4 py-4 lg:px-6 lg:py-8">
        <Link
          href="/"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour
        </Link>

        {/* Carte de présentation COMPACTE — toutes les infos + horaires
            dans une dropdown fermée par défaut. Libère l'écran pour le
            catalogue. */}
        <MerchantHeroCard
          name={m.name}
          category={m.category}
          description_fr={m.description_fr}
          description_ar={m.description_ar}
          cover_url={m.cover_url}
          logo_url={m.logo_url}
          address={m.address}
          commune={m.commune}
          wilaya_name={wilayaName}
          phone_public={m.phone_public}
          min_order_da={m.min_order_da}
          prep_time_min={m.prep_time_min}
          opening_hours={m.opening_hours}
          rating_avg={m.rating_avg}
          rating_count={m.rating_count}
          reviews={reviews}
        />

        {/* Catalogue : catégories en cartes (Deliveroo) + sections collapsibles
            + sheet détail produit. PRIORITÉ : visible directement après la
            carte, sans scroll. */}
        <div className="mt-8 pb-32 lg:pb-12">
          <h2 className="text-foreground mb-3 text-xl font-bold">Le menu</h2>
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
          {/* Plus de section avis en bas — le badge rating dans la card hero
              ci-dessus ouvre une modale "Retours clients" directement. */}
        </div>
      </div>

      {/* CTA panier sticky en bas (mobile + desktop), si panier de ce commerce */}
      <MerchantCartCta merchantId={m.id} />
    </CustomerShell>
  );
}
