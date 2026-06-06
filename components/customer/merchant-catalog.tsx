"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductDetailSheet } from "@/components/customer/product-detail-sheet";
import { ProductRow } from "@/components/customer/product-row";
import { PopularCarousel } from "@/components/customer/popular-carousel";
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
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MerchantCatalog({
  merchant,
  products,
  categories,
  promoPriceById,
}: Props) {
  const t = useTranslations("merchant");
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  // Recherche produit (filtre client, sur le catalogue déjà chargé).
  const [query, setQuery] = useState("");

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
        const hasCat = !!(p.category && p.category.trim());
        const k = hasCat ? p.category!.trim() : "Autres";
        const existing = richByKey.get(k);
        if (existing) existing.items.push(p);
        else
          richByKey.set(k, {
            key: k,
            category: {
              id: k,
              merchant_id: merchant.id,
              title: hasCat ? k : t("otherCategory"),
              image_url: null,
              position: 0,
            },
            items: [p],
          });
      }
    }

    return Array.from(richByKey.values()).filter((g) => g.items.length > 0);
  }, [products, categories, merchant.id, t]);

  // Sélection « Populaires » : on met en avant d'abord les produits en promo,
  // puis les autres en stock — sans inventer de métrique de popularité. Limité
  // à 10 cartes et affiché seulement si le catalogue est assez fourni.
  const popular = useMemo(() => {
    const available = products.filter(
      (p) =>
        p.is_available !== false && (p.stock_qty == null || p.stock_qty > 0)
    );
    const promo = available.filter((p) => promoPriceById[p.id] != null);
    const rest = available.filter((p) => promoPriceById[p.id] == null);
    return [...promo, ...rest].slice(0, 10);
  }, [products, promoPriceById]);

  // Groupes filtrés par la recherche (sections vides masquées).
  const q = norm(query.trim());
  const visibleGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((p) => norm(p.name_fr).includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

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
        {t("emptyCatalog")}
      </div>
    );
  }

  return (
    <>
      {/* Recherche produit (style Uber) */}
      <div className="mb-3">
        <div className="border-border bg-surface flex items-center gap-2.5 rounded-[13px] border px-3.5 py-3 shadow-sm">
          <Search className="text-muted size-4 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchProductPlaceholder")}
            className="placeholder:text-hint text-foreground w-full bg-transparent text-[13.5px] font-medium outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("clear")}
              className="text-muted hover:text-foreground shrink-0"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* CHIPS catégories — sticky type Uber Eats (masquées pendant une recherche). */}
      {!q && groups.length > 1 && (
        <>
          {/* Sentinelle utilisée pour détecter l'état "stuck" (cf. effect). */}
          <div ref={stickySentinelRef} aria-hidden className="h-px w-full" />
          <div
            className={cn(
              "sticky top-[calc(env(safe-area-inset-top)+56px)] z-20 -mx-4 mb-4 transition-shadow lg:-mx-6",
              stuck
                ? "border-border border-b bg-white/90 shadow-[0_2px_6px_rgba(0,0,0,0.04)] backdrop-blur-xl"
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
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pe-3.5 text-[13px] font-bold whitespace-nowrap transition-colors active:scale-[0.96]",
                        g.category?.image_url ? "ps-1.5" : "ps-3.5",
                        active
                          ? "border-primary-600 bg-primary-600 text-white shadow-[0_6px_16px_-4px_rgba(92,92,224,0.45)]"
                          : "border-border bg-surface text-foreground hover:border-primary-300 shadow-[0_2px_6px_-3px_rgba(40,35,90,0.12)]"
                      )}
                    >
                      {g.category?.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.category.image_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-7 shrink-0 rounded-full object-cover"
                        />
                      )}
                      {g.category?.title ?? t("otherCategory")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* POPULAIRES — carrousel horizontal (masqué pendant une recherche). */}
      {!q && popular.length >= 4 && (
        <PopularCarousel
          merchant={merchant}
          products={popular}
          promoPriceById={promoPriceById}
          onOpenDetail={(p) => setSelected(p)}
        />
      )}

      {/* SECTIONS — toutes visibles (pas d'accordéon). Chacune a un petit
          titre h2 et la liste compacte des produits dessous. */}
      {q && visibleGroups.length === 0 && (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-10 text-center text-sm">
          {t("noProductMatch", { query })}
        </div>
      )}

      <div className="space-y-6">
        {visibleGroups.map((g) => (
          <section
            key={g.key}
            id={`cat-${g.key}`}
            ref={(el) => {
              if (el) sectionRefs.current.set(g.key, el);
              else sectionRefs.current.delete(g.key);
            }}
            className="scroll-mt-[calc(env(safe-area-inset-top)+118px)]"
          >
            <h2 className="font-display text-foreground mb-2.5 flex items-center gap-2.5 px-1 text-lg font-bold">
              {g.category?.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.category.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-8 shrink-0 rounded-[10px] object-cover shadow-[0_3px_8px_-3px_rgba(0,0,0,0.2)]"
                />
              )}
              <span className="truncate">
                {g.category?.title ?? t("otherCategory")}
              </span>
              <span className="text-subtle ms-auto shrink-0 text-xs font-bold">
                {t("productCount", { count: g.items.length })}
              </span>
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
