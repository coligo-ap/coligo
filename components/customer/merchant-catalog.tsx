"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ProductDetailSheet } from "@/components/customer/product-detail-sheet";
import { ProductRow } from "@/components/customer/product-row";
import type {
  PublicCategory,
  PublicProduct,
} from "@/lib/data/customer-catalog";

type Props = {
  merchant: { id: string; slug: string; name: string };
  products: PublicProduct[];
  categories: PublicCategory[];
  /** Map productId → prix unitaire après meilleure promo produit, le cas échéant. */
  promoPriceById: Record<string, number>;
};

const UNCAT_KEY = "__uncat__";

/**
 * Catalogue d'un commerce. Pattern Deliveroo :
 *   1. Bande de "category cards" (chips ou cartes-images) en haut — clic =
 *      ouverture/scroll vers la section.
 *   2. Sections produits par catégorie, en accordéons collapsibles.
 *      Première catégorie ouverte par défaut (l'utilisateur voit
 *      directement des produits sans rien faire).
 *   3. Clic sur un produit → bottom sheet de détails avec ajout au panier.
 *
 * Source des catégories :
 *   - PublicCategory (table dédiée, avec image éventuelle) en priorité.
 *   - Fallback : groupement par le champ texte `products.category`.
 */
export function MerchantCatalog({
  merchant,
  products,
  categories,
  promoPriceById,
}: Props) {
  const [selected, setSelected] = useState<PublicProduct | null>(null);

  // Construit les groupes.
  // 1) On utilise les PublicCategory si au moins un produit est rattaché.
  // 2) Sinon : groupes par le champ texte `category`.
  const groups = useMemo(() => {
    const richByKey: Map<
      string,
      { key: string; category: PublicCategory | null; items: PublicProduct[] }
    > = new Map();

    const hasRich =
      categories.length > 0 && products.some((p) => p.category_id);

    if (hasRich) {
      for (const cat of categories) {
        richByKey.set(cat.id, { key: cat.id, category: cat, items: [] });
      }
      for (const p of products) {
        if (p.category_id && richByKey.has(p.category_id)) {
          richByKey.get(p.category_id)!.items.push(p);
        } else {
          // produit sans category_id → bac "Autres"
          if (!richByKey.has(UNCAT_KEY)) {
            richByKey.set(UNCAT_KEY, {
              key: UNCAT_KEY,
              category: null,
              items: [],
            });
          }
          richByKey.get(UNCAT_KEY)!.items.push(p);
        }
      }
    } else {
      // Fallback : groupage par texte
      for (const p of products) {
        const k = (p.category && p.category.trim()) || "Autres";
        const existing = richByKey.get(k);
        if (existing) existing.items.push(p);
        else
          richByKey.set(k, {
            key: k,
            category: {
              id: k,
              merchant_id: merchant.id,
              title: k,
              image_url: null,
              position: 0,
            },
            items: [p],
          });
      }
    }

    return Array.from(richByKey.values()).filter((g) => g.items.length > 0);
  }, [products, categories, merchant.id]);

  // État "ouvert" par groupe. La première section est ouverte par défaut.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g, i) => [g.key, i === 0]))
  );
  function toggle(key: string) {
    setOpenMap((m) => ({ ...m, [key]: !m[key] }));
  }

  function scrollToGroup(key: string) {
    setOpenMap((m) => ({ ...m, [key]: true }));
    setTimeout(() => {
      document
        .getElementById(`cat-${key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }

  if (products.length === 0) {
    return (
      <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-10 text-center text-sm">
        Ce commerce n&apos;a pas encore publié son catalogue.
      </div>
    );
  }

  return (
    <>
      {/* CATEGORY CARDS — défilement horizontal */}
      {groups.length > 1 && (
        <div className="-mx-4 mb-6 [scrollbar-width:none] overflow-x-auto px-4 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-3 pb-2 lg:min-w-0 lg:flex-wrap">
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => scrollToGroup(g.key)}
                className="group border-border bg-surface hover:border-primary-400 flex w-28 shrink-0 flex-col items-center gap-2 rounded-[14px] border p-2 transition active:scale-[0.98] lg:w-32"
              >
                <div
                  className={cn(
                    "bg-primary-50 size-14 overflow-hidden rounded-full lg:size-16"
                  )}
                >
                  {g.category?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={g.category.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-primary-700 flex h-full w-full items-center justify-center text-lg font-bold">
                      {(g.category?.title ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="text-foreground line-clamp-2 text-center text-xs leading-tight font-semibold">
                  {g.category?.title ?? "Autres"}
                </span>
                <span className="text-subtle text-[10px]">
                  {g.items.length} article{g.items.length > 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SECTIONS ACCORDÉON */}
      <div className="space-y-3">
        {groups.map((g) => {
          const open = openMap[g.key];
          return (
            <section
              key={g.key}
              id={`cat-${g.key}`}
              className="border-border bg-surface scroll-mt-20 overflow-hidden rounded-[16px] border"
            >
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={open}
                className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
              >
                {g.category?.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.category.image_url}
                    alt=""
                    className="border-border size-10 shrink-0 rounded-full border bg-white object-cover"
                  />
                ) : (
                  <div className="bg-primary-50 text-primary-700 flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                    {(g.category?.title ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-foreground text-base font-semibold">
                    {g.category?.title ?? "Autres"}
                  </h3>
                  <p className="text-subtle text-xs">
                    {g.items.length} produit{g.items.length > 1 ? "s" : ""}
                    {hasPromoIn(g.items, promoPriceById) && (
                      <>
                        {" · "}
                        <Badge tone="success">Promos</Badge>
                      </>
                    )}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "text-muted size-5 transition-transform",
                    open && "rotate-180"
                  )}
                />
              </button>
              {open && (
                <ul className="border-border divide-border divide-y border-t">
                  {g.items.map((p) => (
                    <li key={p.id}>
                      <ProductRow
                        merchant={merchant}
                        product={p}
                        promoUnitPriceDa={promoPriceById[p.id] ?? null}
                        onOpenDetail={() => setSelected(p)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Sheet détails produit */}
      <ProductDetailSheet
        merchant={merchant}
        product={selected}
        promoUnitPriceDa={
          selected ? (promoPriceById[selected.id] ?? null) : null
        }
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function hasPromoIn(
  items: PublicProduct[],
  promoPriceById: Record<string, number>
): boolean {
  return items.some(
    (p) => promoPriceById[p.id] != null && promoPriceById[p.id] < p.price_da
  );
}
