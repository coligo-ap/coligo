"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgePercent, ChevronLeft, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import {
  useMerchantSearch,
  resetSearch,
} from "@/lib/customer/merchant-search-store";
import {
  useCatalogDisplay,
  setCatalogDisplay,
  setCatalogGroupsCount,
  resetCatalogDisplay,
} from "@/lib/customer/catalog-display-store";
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
  // (grille de cartes → drill-down). Piloté par le STORE partagé (la bascule
  // vit sur la ligne Retrait/Livraison — CatalogViewToggle). Défaut = choix du
  // commerçant ; préférence client mémorisée par commerce (localStorage).
  // ---------------------------------------------------------------------------
  const displayKey = `coligo:catalog-display:${merchant.id}`;
  const { display: storedDisplay } = useCatalogDisplay();
  const display = storedDisplay ?? defaultDisplay;
  const [openCat, setOpenCat] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(displayKey);
      if (v === "list" || v === "categories") setCatalogDisplay(v);
    } catch {
      /* stockage indisponible → défaut commerçant */
    }
  }, [displayKey]);
  // Bascule (depuis le toggle externe) → referme un éventuel drill-down.
  useEffect(() => {
    setOpenCat(null);
  }, [display]);
  // Recherche produit (filtre client, sur le catalogue déjà chargé).
  // Recherche partagée avec la barre intégrée au header (store global). On
  // réinitialise au démontage (changement de commerce).
  const { query } = useMerchantSearch();
  useEffect(
    () => () => {
      resetSearch();
      resetCatalogDisplay();
    },
    []
  );

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

  // Publie le nombre de groupes → la bascule externe se masque s'il n'y a rien
  // à basculer (< 2 groupes).
  useEffect(() => {
    setCatalogGroupsCount(groups.length);
  }, [groups.length]);

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

  // RECALAGE du scroll à l'ouverture/fermeture d'une catégorie : le drill-down
  // remplace un contenu de hauteur très différente — sans recalage, l'ancienne
  // position de scroll « atterrit » au milieu du bas de page (footer/nav qui se
  // superposent visuellement au contenu court). On remonte au début du
  // catalogue, sauf au premier rendu.
  const catalogTopRef = useRef<HTMLDivElement | null>(null);
  const openCatMounted = useRef(false);
  useEffect(() => {
    if (!openCatMounted.current) {
      openCatMounted.current = true;
      return;
    }
    catalogTopRef.current?.scrollIntoView({ block: "start" });
  }, [openCat]);

  if (products.length === 0) {
    return (
      <div className="border-border bg-surface text-muted rounded-md border px-6 py-10 text-center text-sm">
        {t("emptyCatalog")}
      </div>
    );
  }

  return (
    <>
      {/* Ancre de recalage du scroll (drill-down catégorie) — marge de
          défilement = topbar fixe de la fiche commerce. */}
      <div
        ref={catalogTopRef}
        aria-hidden
        className="scroll-mt-[calc(env(safe-area-inset-top)+64px)]"
      />
      {/* Recherche : UNE seule barre (header). Bascule liste/catégories : sur
          la ligne Retrait/Livraison (CatalogViewToggle, store partagé). */}

      {/* CHIPS catégories — sticky type Uber Eats / Bolt (masquées pendant une
          recherche). Visibles en mode LISTE (scroll vers la section) ET dans le
          DRILL-DOWN catégories (bascule directe de catégorie, chip « Tout » en
          tête pour revenir à la grille) — navigation rapide façon Bolt. */}
      {!q &&
        groups.length > 1 &&
        (display === "list" ||
          (display === "categories" && openCat !== null)) && (
          <>
            {/* Sentinelle utilisée pour détecter l'état "stuck" (cf. effect). */}
            <div ref={stickySentinelRef} aria-hidden className="h-px w-full" />
            <div
              className={cn(
                "sticky top-[calc(env(safe-area-inset-top)+56px)] z-20 -mx-4 mb-4 transition-shadow lg:-mx-6",
                stuck
                  ? "border-border border-b bg-white/90 shadow-[0_2px_6px_rgba(0,0,0,0.04)] backdrop-blur-xl"
                  : "bg-white"
              )}
            >
              <div
                ref={stripRef}
                className="snap-x [scrollbar-width:none] overflow-x-auto px-4 py-2 lg:px-6 [&::-webkit-scrollbar]:hidden"
              >
                {/* PILULES TEXTE PLATES façon Bolt : fond gris, texte noir gras,
                    active = pleine (violet marque) — plus d'images ni bordures. */}
                <div className="flex min-w-max gap-2">
                  {display === "categories" && openCat !== null && (
                    <button
                      type="button"
                      onClick={() => setOpenCat(null)}
                      className="bg-surface-2 text-foreground hover:bg-surface-3 text-body inline-flex shrink-0 snap-start items-center rounded-full px-4 py-2 font-bold whitespace-nowrap transition-colors active:scale-[0.96]"
                    >
                      {t("allChip")}
                    </button>
                  )}
                  {groups.map((g) => {
                    const drill = display === "categories" && openCat !== null;
                    const active = drill
                      ? openCat === g.key
                      : activeKey === g.key;
                    const title = g.category?.title ?? t("otherCategory");
                    return (
                      <button
                        key={g.key}
                        type="button"
                        ref={(el) => {
                          if (el) chipRefs.current.set(g.key, el);
                          else chipRefs.current.delete(g.key);
                        }}
                        onClick={() => {
                          if (display === "categories" && openCat !== null) {
                            // Drill-down : bascule DIRECTE de catégorie (Bolt).
                            setOpenCat(g.key);
                            setActiveKey(g.key);
                          } else {
                            scrollToGroup(g.key);
                          }
                        }}
                        className={cn(
                          "text-body inline-flex shrink-0 snap-start items-center rounded-full px-4 py-2 font-bold whitespace-nowrap transition-colors active:scale-[0.96]",
                          active
                            ? "bg-primary-600 text-white"
                            : "bg-surface-2 text-foreground hover:bg-surface-3"
                        )}
                      >
                        {title}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

      {/* ACHAT OFFERT — carrousel dédié des offres quantité, EN PREMIER
          (masqué en recherche ET dans une catégorie ouverte : le drill-down ne
          montre QUE les produits de la catégorie choisie). */}
      {!q && openCat === null && offertProducts.length > 0 && (
        <ProductCarousel
          title={t("offertCarousel")}
          icon={<Gift className="text-accent-600 size-5" />}
          merchant={merchant}
          products={offertProducts}
          promoPriceById={promoPriceById}
          quantityOfferByProduct={quantityOfferByProduct}
          onOpenDetail={(p) => setSelected(p)}
          // Titre promo en rose foncé, cohérent avec les carrousels de promo.
          titleClassName="text-accent-700"
        />
      )}

      {/* PROMOS — carrousels de réduction produit (par promo), masqués en
          recherche et en catégorie ouverte. Affichés AVANT « Populaires ». */}
      {!q && openCat === null && promoCarousels.length > 0 && (
        <PromoCarousels
          merchant={merchant}
          promotions={promoCarousels}
          products={products}
          promoPriceById={promoPriceById}
          quantityOfferByProduct={quantityOfferByProduct}
          onOpenDetail={(p) => setSelected(p)}
        />
      )}

      {/* POPULAIRES — carrousel horizontal (masqué pendant une recherche ou
          dans une catégorie ouverte). */}
      {!q && openCat === null && popular.length >= 4 && (
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
        <div className="border-border bg-surface text-muted rounded-md border px-6 py-10 text-center text-sm">
          {t("noProductMatch", { query })}
        </div>
      )}

      {/* MODE CATÉGORIES (sans recherche) : grille de cartes OU drill-down. */}
      {!q && display === "categories" && openCat === null && (
        // Colonnes RESPONSIVES : 3 en mobile → 6 en desktop (conteneur 1100px),
        // sinon les tuiles aspect-[3/4] deviennent démesurées sur grand écran.
        <div
          id="catalog-sections"
          className="grid scroll-mt-[calc(env(safe-area-inset-top)+64px)] grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
        >
          {groups.map((g) => {
            const title = g.category?.title ?? t("otherCategory");
            // Promos/réductions remontées sur la tuile : incite à ouvrir la
            // catégorie (le mode catégories ne montre pas les produits).
            const promoCount = g.items.filter(
              (p) =>
                promoPriceById[p.id] != null ||
                quantityOfferByProduct[p.id] != null
            ).length;
            // Image de la catégorie (si le commerçant en a mis une) — même
            // source que les chips/sections. Optimisée Cloudinary quand c'est
            // possible, URL brute sinon (Supabase Storage…).
            const img = g.category?.image_url
              ? (cldUrl(g.category.image_url, {
                  width: 360,
                  height: 360,
                  crop: "fill",
                  gravity: "auto",
                }) ?? g.category.image_url)
              : null;
            // ── Tuile façon BOLT (capture food.bolt.eu/…/bolt-market) : carte
            //    GRISE PLATE (ni bordure ni ombre), TITRE noir gras EN HAUT à
            //    gauche, PHOTO en bas (object-contain sur le fond gris). Sans
            //    photo : grande initiale en filigrane à la place. ──
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  setOpenCat(g.key);
                  setActiveKey(g.key);
                }}
                aria-label={title}
                className="bg-surface-2 group relative flex aspect-[3/4] flex-col overflow-hidden rounded-lg p-2.5 text-start transition-transform duration-150 active:scale-[0.97]"
              >
                <span className="text-foreground text-body-sm line-clamp-2 block leading-snug font-bold">
                  {title}
                </span>
                <span
                  className="relative mt-auto block h-[62%] w-full overflow-hidden rounded-md"
                  style={{
                    /* Socle photo CLAIR figé (identique clair/sombre). En clair il
                       se fond dans la carte (bg-surface-2 ≈ #f7f7fb) → aucun
                       changement visuel. En SOMBRE il devient un socle clair sur
                       lequel la photo — souvent sur fond blanc, détourée via
                       `mix-blend-multiply` — RESTE lisible : sans lui, `multiply`
                       sur la carte quasi-noire écrasait l'image en noir (bug « la
                       catégorie ne s'adapte pas au sombre »). `isolate` = le
                       multiply se mélange à CE socle, jamais au fond de carte. */
                    background: "linear-gradient(180deg,#f7f8fc,#eef0f6)",
                    isolation: "isolate",
                  }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="text-primary-600/15 grid h-full w-full place-items-center text-6xl font-black"
                    >
                      {title.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                {promoCount > 0 && (
                  <span className="bg-accent-600 text-nano-lg absolute end-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-extrabold whitespace-nowrap text-white shadow-sm">
                    <BadgePercent className="size-3 shrink-0" />
                    {t("categoryPromoCount", { count: promoCount })}
                  </span>
                )}
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
                  className="border-border bg-surface text-foreground hover:border-primary-300 text-body-sm inline-flex items-center gap-1.5 rounded-full border py-2 ps-2.5 pe-3.5 font-bold shadow-sm"
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
                    className="rounded-control size-8 shrink-0 object-cover shadow-[0_3px_8px_-3px_rgba(0,0,0,0.2)]"
                  />
                )}
                <span className="truncate">
                  {g.category?.title ?? t("otherCategory")}
                </span>
                <span className="text-subtle ms-auto shrink-0 text-xs font-bold">
                  {t("productCount", { count: g.items.length })}
                </span>
              </h2>
              {/* 1 colonne mobile, 2 colonnes desktop (lg). Bordures par <li>
                  (équivalent divide-y en 1 col) : border-b sauf dernière ligne,
                  séparateur vertical sur la colonne de gauche. */}
              <ul className="border-border bg-surface overflow-hidden rounded-md border lg:grid lg:grid-cols-2">
                {g.items.map((p) => (
                  <li
                    key={p.id}
                    className="border-border border-b last:border-b-0 lg:odd:border-e lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
                  >
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
        <div
          id="catalog-sections"
          className="scroll-mt-[calc(env(safe-area-inset-top)+118px)] space-y-6"
        >
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
                    className="rounded-control size-8 shrink-0 object-cover shadow-[0_3px_8px_-3px_rgba(0,0,0,0.2)]"
                  />
                )}
                <span className="truncate">
                  {g.category?.title ?? t("otherCategory")}
                </span>
                <span className="text-subtle ms-auto shrink-0 text-xs font-bold">
                  {t("productCount", { count: g.items.length })}
                </span>
              </h2>
              {/* 1 colonne mobile, 2 colonnes desktop (lg). Bordures par <li>
                  (équivalent divide-y en 1 col) : border-b sauf dernière ligne,
                  séparateur vertical sur la colonne de gauche. */}
              <ul className="border-border bg-surface overflow-hidden rounded-md border lg:grid lg:grid-cols-2">
                {g.items.map((p) => (
                  <li
                    key={p.id}
                    className="border-border border-b last:border-b-0 lg:odd:border-e lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
                  >
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
