"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ProductDetailSheet } from "@/components/customer/product-detail-sheet";
import { ProductRow } from "@/components/customer/product-row";
import type {
  PublicCategory,
  PublicProduct,
} from "@/lib/data/customer-catalog";

type Props = {
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  };
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

  // Catégorie active (chip violet + scroll). Calculée via IntersectionObserver
  // sur les sections : la section la plus visible donne le `activeKey`.
  const [activeKey, setActiveKey] = useState<string | null>(
    groups[0]?.key ?? null
  );
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const stripRef = useRef<HTMLDivElement | null>(null);
  // Drapeau anti-loop : quand un clic déclenche un scroll programmatique,
  // l'observer va voir défiler plusieurs sections — on ignore ces transitions
  // intermédiaires pour ne pas écraser la catégorie cliquée.
  const programmaticScrollRef = useRef<{ key: string; until: number } | null>(
    null
  );
  // Bordure/ombre sous la barre quand elle commence à coller en haut.
  const [stuck, setStuck] = useState(false);
  const stickySentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (groups.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const lock = programmaticScrollRef.current;
        if (lock && Date.now() < lock.until) return;
        // Section dont la plus grande partie est dans le viewport (avec une
        // marge du haut pour compenser le header sticky + chips).
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          const id = (visible[0].target as HTMLElement).id;
          const key = id.replace(/^cat-/, "");
          setActiveKey(key);
        }
      },
      {
        // -40 % du haut : la section est considérée "active" quand son haut
        // arrive vers le tiers haut de l'écran.
        rootMargin: "-40% 0px -40% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [groups]);

  // Détecte le moment où la barre devient sticky (utilise une sentinelle 1px
  // juste au-dessus : quand elle sort du viewport, la barre est collée).
  useEffect(() => {
    const sentinel = stickySentinelRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // À chaque changement de catégorie active, on recentre horizontalement la
  // chip correspondante dans la bande (Uber Eats / Glovo).
  useEffect(() => {
    if (!activeKey) return;
    const chip = chipRefs.current.get(activeKey);
    const strip = stripRef.current;
    if (!chip || !strip) return;
    const cRect = chip.getBoundingClientRect();
    const sRect = strip.getBoundingClientRect();
    const offset =
      chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2;
    if (cRect.left < sRect.left + 16 || cRect.right > sRect.right - 16) {
      strip.scrollTo({ left: offset, behavior: "smooth" });
    }
  }, [activeKey]);

  function scrollToGroup(key: string) {
    setActiveKey(key);
    // Bloque l'observer pendant ~700 ms le temps que le smooth-scroll finisse.
    programmaticScrollRef.current = { key, until: Date.now() + 700 };
    document
      .getElementById(`cat-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      {/* CHIPS catégories — sticky type Uber Eats. Reste collée sous le header
          pendant le scroll, recentre automatiquement la chip active, et fait
          apparaître une fine ombre/bordure dès qu'elle est "stuck". */}
      {groups.length > 1 && (
        <>
          {/* Sentinelle utilisée pour détecter l'état "stuck" (cf. effect). */}
          <div ref={stickySentinelRef} aria-hidden className="h-px w-full" />
          <div
            className={cn(
              "sticky top-[57px] z-20 -mx-4 mb-4 transition-shadow lg:top-16 lg:-mx-6",
              stuck
                ? "border-border border-b bg-white shadow-[0_2px_6px_rgba(0,0,0,0.04)]"
                : "bg-surface-2"
            )}
          >
            <div
              ref={stripRef}
              className="[scrollbar-width:none] overflow-x-auto px-4 py-2 lg:px-6 [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex min-w-max gap-1.5">
                {groups.map((g) => {
                  const active = activeKey === g.key;
                  return (
                    <button
                      key={g.key}
                      type="button"
                      ref={(el) => {
                        if (el) chipRefs.current.set(g.key, el);
                        else chipRefs.current.delete(g.key);
                      }}
                      onClick={() => scrollToGroup(g.key)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors active:scale-[0.96]",
                        active
                          ? "border-primary-600 bg-primary-600 text-white"
                          : "border-border bg-surface text-foreground hover:border-primary-300"
                      )}
                    >
                      {g.category?.title ?? "Autres"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* SECTIONS — toutes visibles (pas d'accordéon). Chacune a un petit
          titre h2 et la liste compacte des produits dessous. */}
      <div className="space-y-6">
        {groups.map((g) => (
          <section
            key={g.key}
            id={`cat-${g.key}`}
            ref={(el) => {
              if (el) sectionRefs.current.set(g.key, el);
              else sectionRefs.current.delete(g.key);
            }}
            className="scroll-mt-[112px] lg:scroll-mt-[120px]"
          >
            <h2 className="font-display text-foreground mb-2 px-1 text-lg font-bold">
              {g.category?.title ?? "Autres"}
            </h2>
            <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[16px] border">
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
          </section>
        ))}
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
