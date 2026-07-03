"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Gift, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMerchantSearch,
  setSearchQuery,
  resetSearch,
} from "@/lib/customer/merchant-search-store";
import { ProductDetailSheet } from "@/components/customer/product-detail-sheet";
import { ProductRow } from "@/components/customer/product-row";
import {
  PopularCarousel,
  ProductCarousel,
} from "@/components/customer/popular-carousel";
import { PromoCarousels } from "@/components/customer/promo-carousels";
import type {
  PublicCategory,
  PublicProduct,
  PublicPromotion,
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
  /** Map productId → offre quantité la plus généreuse (libellé « X+Y offert »). */
  quantityOfferByProduct: Record<string, { buy: number; get: number }>;
  /** Promotions à produits, ordonnées (offres quantité d'abord) pour les carrousels. */
  promoCarousels: PublicPromotion[];
  /** Affichage par défaut choisi par le COMMERÇANT (le client peut basculer). */
  defaultDisplay?: "list" | "categories";
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
  quantityOfferByProduct,
  promoCarousels,
  defaultDisplay = "list",
}: Props) {
  const t = useTranslations("merchant");
  const [selected, setSelected] = useState<PublicProduct | null>(null);

  // ---------------------------------------------------------------------------
  // AFFICHAGE : « liste » (sections déroulées) ou « catégories d'abord »
  // (grille de cartes → drill-down). Défaut = choix du commerçant ; le client
  // peut basculer, préférence mémorisée par commerce (localStorage).
  // ---------------------------------------------------------------------------
  const displayKey = `coligo:catalog-display:${merchant.id}`;
  const [display, setDisplay] = useState<"list" | "categories">(defaultDisplay);
  const [openCat, setOpenCat] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(displayKey);
      if (v === "list" || v === "categories") setDisplay(v);
    } catch {
      /* stockage indisponible → défaut commerçant */
    }
  }, [displayKey]);
  function switchDisplay(v: "list" | "categories") {
    setDisplay(v);
    setOpenCat(null);
    try {
      window.localStorage.setItem(displayKey, v);
    } catch {
      /* préférence non mémorisée, sans gravité */
    }
  }
  // Recherche produit (filtre client, sur le catalogue déjà chargé).
  // Recherche partagée avec la barre intégrée au header (store global). On
  // réinitialise au démontage (changement de commerce).
  const { query } = useMerchantSearch();
  useEffect(() => () => resetSearch(), []);

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

  // « Achat offert » : tous les produits concernés par une offre quantité
  // active (disponibles + en stock), pour un carrousel dédié en tête.
  const offertProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          quantityOfferByProduct[p.id] != null &&
          p.is_available !== false &&
          (p.stock_qty == null || p.stock_qty > 0)
      ),
    [products, quantityOfferByProduct]
  );

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
      <div className="border-border bg-surface text-muted rounded-[12px] border px-6 py-10 text-center text-sm">
        {t("emptyCatalog")}
      </div>
    );
  }

  return (
    <>
      {/* Recherche produit (style Uber) + bascule liste/catégories */}
      <div className="mb-3 flex items-center gap-2">
        <div className="border-border-strong bg-surface flex flex-1 items-center gap-2.5 rounded-full border px-4 py-3">
          <Search className="text-muted size-4 shrink-0" />
          <input
            id="merchant-product-search"
            type="search"
            value={query}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchProductPlaceholder")}
            className="placeholder:text-hint text-foreground w-full bg-transparent text-[13.5px] font-medium outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={t("clear")}
              className="text-muted hover:text-foreground shrink-0"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {groups.length > 1 && (
          <div
            role="group"
            aria-label={t("viewToggleAria")}
            className="border-border bg-surface flex shrink-0 items-center rounded-[13px] border p-1 shadow-sm"
          >
            <button
              type="button"
              onClick={() => switchDisplay("categories")}
              aria-pressed={display === "categories"}
              title={t("viewAsCategories")}
              className={cn(
                "flex size-9 items-center justify-center rounded-[10px] transition-colors",
                display === "categories"
                  ? "bg-primary-600 text-white"
                  : "text-muted hover:text-foreground"
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => switchDisplay("list")}
              aria-pressed={display === "list"}
              title={t("viewAsList")}
              className={cn(
                "flex size-9 items-center justify-center rounded-[10px] transition-colors",
                display === "list"
                  ? "bg-primary-600 text-white"
                  : "text-muted hover:text-foreground"
              )}
            >
              <Rows3 className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* CHIPS catégories — sticky type Uber Eats (masquées pendant une recherche). */}
      {!q && display === "list" && groups.length > 1 && (
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
                          ? "border-primary-600 bg-primary-600 text-white shadow-[0_6px_16px_-4px_rgba(108,43,217,0.45)]"
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

      {/* ACHAT OFFERT — carrousel dédié des offres quantité, EN PREMIER
          (masqué en recherche). Met en avant tous les produits « X = Y offert ». */}
      {!q && offertProducts.length > 0 && (
        <ProductCarousel
          title={t("offertCarousel")}
          icon={<Gift className="text-accent-600 size-5" />}
          merchant={merchant}
          products={offertProducts}
          promoPriceById={promoPriceById}
          quantityOfferByProduct={quantityOfferByProduct}
          onOpenDetail={(p) => setSelected(p)}
        />
      )}

      {/* PROMOS — carrousels de réduction produit (par promo), masqués en
          recherche. Affichés AVANT « Populaires ». */}
      {!q && promoCarousels.length > 0 && (
        <PromoCarousels
          merchant={merchant}
          promotions={promoCarousels}
          products={products}
          promoPriceById={promoPriceById}
          quantityOfferByProduct={quantityOfferByProduct}
          onOpenDetail={(p) => setSelected(p)}
        />
      )}

      {/* POPULAIRES — carrousel horizontal (masqué pendant une recherche). */}
      {!q && popular.length >= 4 && (
        <PopularCarousel
          merchant={merchant}
          products={popular}
          promoPriceById={promoPriceById}
          quantityOfferByProduct={quantityOfferByProduct}
          onOpenDetail={(p) => setSelected(p)}
        />
      )}

      {/* SECTIONS — toutes visibles (pas d'accordéon). Chacune a un petit
          titre h2 et la liste compacte des produits dessous. */}
      {q && visibleGroups.length === 0 && (
        <div className="border-border bg-surface text-muted rounded-[12px] border px-6 py-10 text-center text-sm">
          {t("noProductMatch", { query })}
        </div>
      )}

      {/* MODE CATÉGORIES (sans recherche) : grille de cartes OU drill-down. */}
      {!q && display === "categories" && openCat === null && (
        <div className="grid grid-cols-3 gap-3">
          {groups.map((g) => {
            const title = g.category?.title ?? t("otherCategory");
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setOpenCat(g.key)}
                aria-label={title}
                className="bg-primary-50 dark:bg-primary-950/40 group relative aspect-[3/4] overflow-hidden rounded-[14px] p-3 text-center transition-transform duration-150 active:scale-[0.97]"
              >
                {/* Titre en haut, centré (2 lignes max) — typographie Yassir. */}
                <span className="text-foreground relative z-10 mx-auto line-clamp-2 block text-[13.5px] leading-snug font-bold">
                  {title}
                </span>
                <span className="text-subtle relative z-10 mt-0.5 block text-[10.5px] font-semibold">
                  {t("productCount", { count: g.items.length })}
                </span>
                {/* Grand chevron en filigrane, bas de tuile (sens RTL géré). */}
                <ChevronLeft
                  aria-hidden
                  strokeWidth={3.5}
                  className="text-primary-600/15 absolute start-1/2 bottom-4 size-20 -translate-x-1/2 rotate-180 transition-transform duration-200 group-hover:translate-x-[-42%] rtl:translate-x-1/2 rtl:-rotate-0 rtl:group-hover:translate-x-[42%]"
                />
              </button>
            );
          })}
        </div>
      )}

      {!q &&
        display === "categories" &&
        openCat !== null &&
        (() => {
          const g = groups.find((x) => x.key === openCat);
          if (!g) return null;
          return (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenCat(null)}
                  className="border-border bg-surface text-foreground hover:border-primary-300 inline-flex items-center gap-1.5 rounded-full border py-2 ps-2.5 pe-3.5 text-[13px] font-bold shadow-sm"
                >
                  <ChevronLeft className="size-4 rtl:rotate-180" />
                  {t("allCategories")}
                </button>
              </div>
              <h2 className="font-display text-foreground mb-2.5 flex items-center gap-2.5 px-1 text-lg font-bold">
                {g.category?.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.category.image_url}
                    alt=""
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
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[12px] border">
                {g.items.map((p) => (
                  <li key={p.id}>
                    <ProductRow
                      merchant={merchant}
                      product={p}
                      promoUnitPriceDa={promoPriceById[p.id] ?? null}
                      quantityOffer={quantityOfferByProduct[p.id] ?? null}
                      onOpenDetail={() => setSelected(p)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })()}

      {/* MODE LISTE (ou recherche active) : sections déroulées historiques. */}
      {(q.length > 0 || display === "list") && (
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
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-[12px] border">
                {g.items.map((p) => (
                  <li key={p.id}>
                    <ProductRow
                      merchant={merchant}
                      product={p}
                      promoUnitPriceDa={promoPriceById[p.id] ?? null}
                      quantityOffer={quantityOfferByProduct[p.id] ?? null}
                      onOpenDetail={() => setSelected(p)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

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
