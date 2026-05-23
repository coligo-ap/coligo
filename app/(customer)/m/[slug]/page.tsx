import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, MapPin, Phone } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getPublicMerchantBySlug } from "@/lib/data/merchants-public";
import {
  listMerchantProducts,
  listMerchantPromotions,
} from "@/lib/data/customer-catalog";
import { WILAYAS } from "@/lib/config/wilayas";
import { DAY_KEYS, DAY_LABELS } from "@/lib/types";
import { OpenStatusBadge } from "@/components/merchant/settings/open-status-badge";
import { ProductCard } from "@/components/customer/product-card";
import { MerchantCartCta } from "@/components/customer/merchant-cart-cta";
import {
  discountedUnitPrice,
  isPromotionActive,
} from "@/lib/promotions/engine";
import { APP_CONFIG } from "@/lib/config/app-config";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MerchantPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = await getPublicMerchantBySlug(slug);
  if (!m) notFound();

  const [catalog, promotions] = await Promise.all([
    listMerchantProducts(m.id),
    listMerchantPromotions(m.id),
  ]);

  const wilaya = m.wilaya_code
    ? WILAYAS.find((w) => w.code === m.wilaya_code)?.name
    : null;

  // Pré-calcule un prix promo unitaire par produit (la meilleure remise produit).
  const now = new Date();
  const productPromos = promotions.filter(
    (p) => p.type === "product_discount" && isPromotionActive(p as never, now)
  );
  const promoPriceByProduct = new Map<string, number>();
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
    if (best < product.price_da) promoPriceByProduct.set(product.id, best);
  }

  // Regroupe par catégorie (titre = catégorie produit OU "Sans catégorie").
  const byCategory = new Map<string, typeof catalog.products>();
  for (const p of catalog.products) {
    const key = p.category?.trim() || "Autres";
    const arr = byCategory.get(key) ?? [];
    arr.push(p);
    byCategory.set(key, arr);
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

        {/* Cover */}
        <div className="bg-surface-2 relative aspect-[3/1] w-full overflow-hidden rounded-[20px]">
          {m.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="from-primary-500/10 to-surface-2 absolute inset-0 bg-gradient-to-br" />
          )}
        </div>

        <div className="bg-surface border-border relative mx-3 -mt-10 rounded-[20px] border p-5 shadow-sm lg:mx-10 lg:p-6">
          <div className="flex flex-wrap items-start gap-4">
            {m.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.logo_url}
                alt=""
                className="-mt-16 size-24 shrink-0 rounded-full border-4 border-white bg-white object-cover shadow-md lg:-mt-20 lg:size-28"
              />
            ) : (
              <div className="bg-primary-100 text-primary-700 -mt-16 flex size-24 shrink-0 items-center justify-center rounded-full border-4 border-white text-2xl font-bold shadow-md lg:-mt-20 lg:size-28">
                {m.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
                {m.name}
              </h1>
              {m.category && <p className="text-muted text-sm">{m.category}</p>}
              <div className="mt-2">
                <OpenStatusBadge hours={m.opening_hours} />
              </div>
            </div>
          </div>

          {m.description_fr && (
            <p className="text-foreground mt-4 text-sm">{m.description_fr}</p>
          )}
          {m.description_ar && (
            <p className="text-foreground mt-2 text-sm" dir="rtl">
              {m.description_ar}
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <InfoCard icon={MapPin} title="Adresse">
            {[m.address, m.commune, wilaya].filter(Boolean).join(" · ") ||
              "Non renseignée"}
          </InfoCard>
          <InfoCard icon={Phone} title="Téléphone">
            {m.phone_public ?? "Non renseigné"}
          </InfoCard>
          <InfoCard icon={Clock} title="Commande">
            {m.min_order_da > 0
              ? `Minimum ${formatDA(m.min_order_da)}`
              : "Pas de minimum"}
            <span className="text-muted block text-[11px]">
              Préparation env. {m.prep_time_min} min
            </span>
          </InfoCard>
        </div>

        {/* Catalogue */}
        <section className="mt-8">
          <header className="mb-3 flex items-baseline justify-between">
            <h2 className="text-foreground text-xl font-bold">Le menu</h2>
            <span className="text-muted text-xs">
              {catalog.products.length} produit
              {catalog.products.length > 1 ? "s" : ""}
            </span>
          </header>

          {catalog.products.length === 0 ? (
            <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-10 text-center text-sm">
              Ce commerce n&apos;a pas encore publié son catalogue.
            </div>
          ) : (
            <div className="space-y-8 pb-32 lg:pb-12">
              {Array.from(byCategory.entries()).map(([cat, items]) => (
                <div key={cat}>
                  <h3 className="text-foreground mb-3 text-base font-semibold">
                    {cat}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {items.map((p) => (
                      <ProductCard
                        key={p.id}
                        merchant={{ id: m.id, slug: m.slug, name: m.name }}
                        product={p}
                        promoUnitPriceDa={promoPriceByProduct.get(p.id) ?? null}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-border bg-surface mt-8 rounded-[16px] border p-5">
          <h2 className="text-foreground mb-3 text-base font-semibold">
            Horaires
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {DAY_KEYS.map((d) => {
              const slots = m.opening_hours[d];
              return (
                <li
                  key={d}
                  className="text-foreground flex items-center justify-between text-sm"
                >
                  <span className="font-medium">{DAY_LABELS[d].long}</span>
                  <span className="text-muted tabular-nums">
                    {slots.length === 0
                      ? "Fermé"
                      : slots.map((s) => `${s.open}–${s.close}`).join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* CTA panier sticky en bas (mobile + desktop), si panier de ce commerce */}
      <MerchantCartCta merchantId={m.id} />
    </CustomerShell>
  );
}

function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-4">
      <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="text-foreground text-sm">{children}</div>
    </div>
  );
}
